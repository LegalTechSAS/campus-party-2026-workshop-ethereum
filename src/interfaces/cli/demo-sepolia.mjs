/** Demo pública y recuperable: rechazo con devolución y revert minado en Sepolia. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { keccak256, parseEther, toUtf8Bytes } from "ethers";
import { SepoliaProtocol } from "../../infrastructure/ethereum/sepolia-protocol.mjs";
import {
  loadSepoliaConfig,
  publicError,
} from "../../infrastructure/config/sepolia-config.mjs";

const root = process.cwd(),
  file = path.join(root, "data/sepolia/demo-reject-revert.json");
let protocol, lock, run;
// El mismo bloqueo del agente impide superponer demostración y trabajo autónomo.
const lockFile = path.join(root, "data/agent.lock");
async function save() {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file + ".tmp", JSON.stringify(run, null, 2));
  await fs.rename(file + ".tmp", file);
}
try {
  await fs.mkdir(path.dirname(lockFile), { recursive: true });
  lock = await fs.open(lockFile, "wx");
  await lock.writeFile(JSON.stringify({ pid: process.pid }));
  protocol = new SepoliaProtocol(root, loadSepoliaConfig(root));
  await protocol.init({ deploy: false });
  try {
    run = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!run || run.completed) {
    run = {
      id: randomUUID(),
      contract: protocol.address,
      startedAt: new Date().toISOString(),
      transactions: [],
    };
    await save();
  }
  if (run.contract !== protocol.address)
    throw Error("La demo pendiente corresponde a otro contrato.");
  const hash = keccak256(toUtf8Bytes("Demostración pública de revert y reject CAMPUS"));
  console.log(
    "\nReject y revert en Sepolia\nSe usa ETH de prueba para gas. Esta demo no consulta IA ni IPFS y no registra reputación.\n",
  );
  if (!run.jobId) {
    console.log("1. Creando el encargo.");
    run.before = await protocol.balances();
    const created = await protocol.create(
      "Demo pública Campus Party: revert y rechazo con devolución",
    );
    run.jobId = created.id;
    run.transactions.push(created.evidence);
    await save();
  }
  if ((await protocol.state(run.jobId)) === 0) {
    console.log("2. Depositando 10 CAMPUS.");
    run.transactions.push(...(await protocol.fund(run.jobId)));
    await save();
  }
  if (!run.revert) {
    if ((await protocol.state(run.jobId)) !== 1)
      throw Error("El encargo debe estar financiado para demostrar el revert.");
    console.log(
      "3. Intentando pagar antes de entregar. Se espera un revert: WrongStatus.",
    );
    // Primero comprueba el motivo exacto, para no confundirlo con falta de gas o permisos.
    await assert.rejects(
      protocol.acp
        .connect(protocol.evaluator)
        .complete.staticCall(run.jobId, hash, "0x"),
      (error) => error.revert?.name === "WrongStatus",
    );
    run.fundedBalances = await protocol.balances();
    const tx = await protocol.acp
      .connect(protocol.evaluator)
      .complete(run.jobId, hash, "0x", { gasLimit: 150000n });
    // gasLimit explícito evita estimateGas: envía intencionalmente la operación inválida.
    // SepoliaSigner conserva los techos de precio y costo máximo de gas.
    run.revert = { hash: tx.hash, url: `https://sepolia.etherscan.io/tx/${tx.hash}` };
    await save();
    console.log("Esperando confirmación: " + run.revert.url);
  }
  if (!run.revert.confirmed) {
    let receipt = await protocol.rpc.getTransactionReceipt(run.revert.hash);
    if (!receipt)
      receipt = await protocol.rpc.waitForTransaction(run.revert.hash, 1, 180000);
    if (!receipt)
      throw Error(
        "Revert pendiente de confirmación. Repetí este comando para continuar, sin reenviarlo.",
      );
    assert.equal(receipt.status, 0, "La transacción debía quedar minada con status 0.");
    assert.equal(await protocol.state(run.jobId), 1);
    assert.deepEqual(await protocol.balances(), run.fundedBalances);
    run.revert = {
      ...run.revert,
      confirmed: true,
      status: 0,
      block: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
    };
    await save();
  }
  console.log(
    "Revert confirmado (Failed, status 0). Los CAMPUS siguen en el contrato. Se pagó gas.\n" +
      run.revert.url,
  );
  console.table(await protocol.balances());
  if (!run.reject && (await protocol.state(run.jobId)) === 1) {
    console.log("\n4. Rechazando el encargo para devolver los 10 CAMPUS.");
    const reason = keccak256(
      toUtf8Bytes("Cancelación didáctica; no es una evaluación de calidad"),
    );
    const tx = await protocol.acp
      .connect(protocol.evaluator)
      .reject(run.jobId, reason, "0x");
    run.reject = { hash: tx.hash, url: `https://sepolia.etherscan.io/tx/${tx.hash}` };
    await save();
  }
  if (!run.reject) throw Error("No hay evidencia de rechazo para esta demo.");
  let receipt = await protocol.rpc.getTransactionReceipt(run.reject.hash);
  if (!receipt)
    receipt = await protocol.rpc.waitForTransaction(run.reject.hash, 1, 180000);
  assert.ok(receipt, "El rechazo sigue pendiente; repetí el comando para continuar.");
  assert.equal(receipt.status, 1);
  assert.equal(await protocol.state(run.jobId), 4);
  const balances = await protocol.balances();
  // Compara contra los saldos iniciales; no asume que el cliente todavía tiene 1000.
  for (const role of ["client", "provider", "escrow"])
    assert.equal(parseEther(balances[role]), parseEther(run.before[role]));
  run.reject = {
    ...run.reject,
    status: 1,
    block: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
  };
  run.after = balances;
  run.completed = true;
  await save();
  await fs.copyFile(file, path.join(path.dirname(file), `demo-${run.id}.json`));
  console.log(
    "Rechazo confirmado (Success, status 1). Los 10 CAMPUS volvieron al cliente.\n" +
      run.reject.url,
  );
  console.table(balances);
  console.log(
    "\nListo. El revert bloqueó el pago y el rechazo devolvió el depósito.\nRegistro: data/sepolia/demo-reject-revert.json\n",
  );
} catch (error) {
  console.error(
    "Error en la demo: " +
      (error.code === "EEXIST"
        ? "Hay un agente u otra demo activos (data/agent.lock)."
        : publicError(error)),
  );
  console.error("Para continuar, repetí el comando. No borres data/sepolia/.");
  process.exitCode = 1;
} finally {
  protocol?.close();
  if (lock) {
    await lock.close();
    await fs.unlink(lockFile);
  }
}
