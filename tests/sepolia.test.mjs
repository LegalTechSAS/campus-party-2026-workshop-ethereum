/**
 * Pruebas del adaptador Sepolia. Las llaves se crean solo en memoria para esta prueba.
 * Una EVM privada con chainId 11155111 verifica firmas y transferencias sin usar fondos públicos.
 * No se presenta este nodo simulado como una ejecución en Sepolia pública.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { Wallet, parseEther, parseUnits, toBeHex } from "ethers";
import {
  loadSepoliaConfig,
  publicError,
} from "../src/infrastructure/config/sepolia-config.mjs";
import { SepoliaProtocol } from "../src/infrastructure/ethereum/sepolia-protocol.mjs";
import { modelEnvironment } from "../src/infrastructure/ai/model.mjs";
import { Protocol } from "../src/infrastructure/ethereum/protocol.mjs";
import { runAutonomous } from "../src/main/run-autonomous.mjs";

// Rechaza configuración incompleta y evita repetir una misma cuenta en los tres roles.
test("configuración Sepolia: HTTPS, llaves válidas y roles distintos", () => {
  assert.throws(() => loadSepoliaConfig(".", {}), /CLIENT_PRIVATE_KEY/u);
  assert.throws(
    () => loadSepoliaConfig(".", { SEPOLIA_RPC_URL: "http://127.0.0.1:8545" }),
    /HTTPS/u,
  );
  const key = Wallet.createRandom().privateKey;
  const configWithoutPrefix = loadSepoliaConfig(".", {
    CLIENT_PRIVATE_KEY: key.slice(2),
    PROVIDER_PRIVATE_KEY: Wallet.createRandom().privateKey.slice(2),
    EVALUATOR_PRIVATE_KEY: Wallet.createRandom().privateKey.slice(2),
  });
  assert.equal(configWithoutPrefix.keys[0], key);
  assert.throws(
    () =>
      loadSepoliaConfig(".", {
        CLIENT_PRIVATE_KEY: key,
        PROVIDER_PRIVATE_KEY: key,
        EVALUATOR_PRIVATE_KEY: key,
      }),
    /distintas/u,
  );
});

// El mismo adaptador utilizado en público firma realmente contra una EVM controlada.
test("firmas Sepolia simulada: gas de roles, despliegue reutilizable, pago y devolución", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "campus-sepolia-"));
  await fs.cp("build", path.join(root, "build"), { recursive: true });
  const child = spawn(
    process.execPath,
    [
      "node_modules/hardhat/dist/src/cli.js",
      "node",
      "--hostname",
      "127.0.0.1",
      "--port",
      "18546",
      "--chain-id",
      "11155111",
    ],
    { stdio: "ignore" },
  );
  const config = {
    rpcURL: "http://127.0.0.1:18546",
    simulation: true,
    keys: [0, 1, 2].map(() => Wallet.createRandom().privateKey),
    maxFeePerGas: parseUnits("20", "gwei"),
    maxTxCost: parseEther("0.05"),
    confirmations: 1,
  };
  let protocol, wrong;
  try {
    protocol = new SepoliaProtocol(root, config);
    protocol.rpc.pollingInterval = 20;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        ready = BigInt(await protocol.rpc.send("eth_chainId", [])) === 11155111n;
        if (ready) break;
      } catch {
        /* El nodo todavía puede estar iniciando. */
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.equal(ready, true);
    // Solo el entorno privado de pruebas permite asignar ETH sin usar un faucet.
    await protocol.rpc.send("hardhat_setBalance", [
      new Wallet(config.keys[0]).address,
      toBeHex(parseEther("1")),
    ]);
    await protocol.fundRoles();
    const roles = await protocol.doctor();
    assert.equal(roles[1].gasETH, "0.002");
    assert.equal(roles[2].gasETH, "0.002");
    await protocol.init();
    assert.equal(await protocol.token.name(), "Campus");
    assert.equal(await protocol.token.symbol(), "CAMPUS");
    const deployment = JSON.parse(
      await fs.readFile(path.join(root, "data/sepolia/deployment.json"), "utf8"),
    );
    assert.equal(deployment.deployments.length, 3);
    assert.equal(deployment.chainId, "11155111");
    assert.ok(deployment.deployments.every((receipt) => receipt.hash && !receipt.url));
    // init de un conjunto ya publicado no vuelve a desplegar ni consumir gas.
    const before = await protocol.rpc.getTransactionCount(
      await protocol.client.getAddress(),
    );
    await protocol.init();
    assert.equal(
      await protocol.rpc.getTransactionCount(await protocol.client.getAddress()),
      before,
    );
    const model = {
      // Respuesta de IA fija: esta prueba valida firmas y protocolo, no calidad del modelo.
      async ask(kind) {
        return kind === "summary"
          ? { summary: "Un contrato coordina una entrega y su pago." }
          : {
              decision: "approve",
              spanish: true,
              faithful: true,
              confidence: 0.99,
              reason: "Prueba simulada",
            };
      },
    };
    const success = await runAutonomous({
      root,
      id: "pago",
      text: "Entrada simulada",
      protocol,
      model,
    });
    assert.equal(success.status, "completed");
    assert.equal(success.balances.provider, "10.0");
    assert.equal(success.chainId, "11155111");
    assert.equal(success.transactions.at(-1).url, undefined);
    // Los archivos de la red pública están separados de los de Hardhat local.
    await fs.access(path.join(root, "data/sepolia/runs/pago/journal.json"));
    const rejected = await runAutonomous({
      root,
      id: "devolucion",
      text: "Otra entrada",
      protocol,
      model: {
        // Simula un resultado que no cumple fidelidad y debe devolver el presupuesto.
        async ask(kind) {
          return kind === "summary"
            ? { summary: "Otro texto." }
            : {
                decision: "reject",
                spanish: true,
                faithful: false,
                confidence: 0.99,
                reason: "Rechazo simulado",
              };
        },
      },
    });
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.balances.client, "990.0");
    assert.equal(rejected.balances.provider, "10.0");
    // Un techo de gas insuficiente debe bloquear la firma antes de enviar.
    config.maxFeePerGas = 1n;
    await assert.rejects(
      protocol.client.sendTransaction({ to: roles[1].address, value: 1n }),
      /comisión/u,
    );
    // El adaptador local tampoco acepta usar este nodo como si fuera red 31337.
    wrong = new Protocol(root, config.rpcURL);
    await assert.rejects(wrong.init(), /31337/u);
  } finally {
    wrong?.close();
    protocol?.close();
    child.kill("SIGTERM");
    await fs.rm(root, { recursive: true, force: true });
  }
});

// La CLI de IA no debe heredar llaves de firma ni un endpoint RPC privado.
test("el entorno del modelo excluye secretos de firma sin mutar el original", () => {
  const source = {
    PATH: "/bin",
    CLIENT_PRIVATE_KEY: "secreto-ficticio",
    PROVIDER_PRIVATE_KEY: "otro",
    EVALUATOR_PRIVATE_KEY: "tercero",
    SEPOLIA_RPC_URL: "https://rpc.example/token",
  };
  const clean = modelEnvironment(source);
  assert.deepEqual(clean, { PATH: "/bin" });
  assert.equal(source.CLIENT_PRIVATE_KEY, "secreto-ficticio");
});

// Los mensajes públicos no incluyen una URL con credenciales ni valores de 32 bytes.
test("los errores públicos omiten endpoints privados y posibles llaves", () => {
  const message = publicError(
    new Error("Falló https://rpc.example/token con 0x" + "a".repeat(64)),
  );
  assert.equal(message.includes("rpc.example"), false);
  assert.equal(message.includes("a".repeat(64)), false);
});
