/** Demuestra reglas reales del contrato en una EVM local temporal, sin IA ni claves privadas. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { keccak256, toUtf8Bytes } from "ethers";
import { Protocol } from "../../infrastructure/ethereum/protocol.mjs";

// El sistema asigna un puerto libre para no interferir con el nodo del participante.
const server = net.createServer();
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const port = server.address().port;
await new Promise((resolve) => server.close(resolve));
const root = await fs.mkdtemp(path.join(os.tmpdir(), "campus-demo-"));
let child, protocol;
try {
  console.log("\nReject y revert en Hardhat local\nNo usa tus wallets ni tu .env.\n");
  await fs.cp("build", path.join(root, "build"), { recursive: true });
  child = spawn(
    process.execPath,
    [
      "node_modules/hardhat/dist/src/cli.js",
      "node",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { stdio: "ignore" },
  );
  protocol = new Protocol(root, `http://127.0.0.1:${port}`);
  protocol.rpc.pollingInterval = 30;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw Error("No se pudo iniciar el nodo temporal.");
    try {
      ready = (await protocol.rpc.send("eth_chainId", [])) === "0x7a69";
    } catch {
      /* El nodo todavía puede estar iniciando. */
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw Error("El nodo local no respondió a tiempo.");
  await protocol.init();
  const hash = keccak256(toUtf8Bytes("Entrega didáctica"));
  console.log("\n1. Creando el encargo y depositando 10 CAMPUS.");
  const { id } = await protocol.create("Demostración: rechazar y devolver el depósito");
  await protocol.fund(id);
  const funded = await protocol.balances();
  console.table(funded);
  assert.equal(funded.client, "990.0");
  assert.equal(funded.escrow, "10.0");

  // staticCall ejecuta las reglas en la EVM, sin enviar una transacción ni gastar gas.
  console.log(
    "\n2. Intentando pagar antes de entregar.\nSe simula con eth_call, sin enviar una transacción.",
  );
  let reverted = false;
  try {
    await protocol.acp.connect(protocol.evaluator).complete.staticCall(id, hash, "0x");
  } catch (error) {
    const reason =
      error.revert?.name ||
      (error.data ? protocol.acp.interface.parseError(error.data)?.name : undefined);
    assert.equal(reason, "WrongStatus");
    reverted = true;
    console.log("WrongStatus: falta la entrega. No se puede pagar.");
  }
  assert.equal(reverted, true, "La operación inválida debía revertir.");
  assert.deepEqual(await protocol.balances(), funded);
  console.log("Los saldos no cambiaron.");

  console.log("\n3. Rechazando el encargo. Se envía una transacción a la red local.");
  await protocol.reject(
    id,
    keccak256(toUtf8Bytes("Cancelación didáctica del encargo")),
  );
  const refunded = await protocol.balances();
  assert.equal(await protocol.state(id), 4);
  assert.equal(refunded.client, "1000.0");
  assert.equal(refunded.escrow, "0.0");
  assert.equal(refunded.provider, "0.0");
  console.table(refunded);
  console.log("Encargo rechazado. Los 10 CAMPUS volvieron al cliente.");
  console.log("\n4. Intentando entregar después del rechazo (eth_call).");
  await assert.rejects(
    protocol.acp.connect(protocol.provider).submit.staticCall(id, hash, "0x"),
    (error) => error.revert?.name === "WrongStatus",
  );
  console.log("WrongStatus: el encargo ya está cerrado.");
  console.log(
    "\nListo. Se comprobó la devolución y los dos reverts con eth_call.\nCerrando el nodo local y borrando los datos temporales.\n",
  );
} catch (error) {
  console.error("Error en la demo:", error.shortMessage || error.message);
  process.exitCode = 1;
} finally {
  protocol?.close();
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
  await fs.rm(root, { recursive: true, force: true });
}
