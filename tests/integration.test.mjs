/**
 * Prueba de integración: despliega contratos reales en Hardhat local
 * y ejecuta transacciones. Solo las respuestas del modelo son simuladas.
 * No requiere una cuenta de Claude/Cursor ni demuestra calidad semántica de IA.
 */

// IA simulada explícitamente; contratos y transacciones reales en Hardhat local.
import { toUtf8String } from "ethers";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { Protocol } from "../scripts/protocol.mjs";
import { runAutonomous } from "../scripts/autonomy.mjs";
// Ejecuta el flujo contra EVM real con respuestas de IA fijas.
test("EVM real: pago, deduplicación y devolución automática por rechazo/error", async () => {
  // Crea un historial aislado y copia los artefactos compilados que se desplegarán.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "campus-evm-"));
  await fs.cp("build", path.join(root, "build"), { recursive: true });
  // Inicia un nodo propio en 18545 para no usar la red del taller en 8545.
  const child = spawn(
    process.execPath,
    [
      "node_modules/hardhat/dist/src/cli.js",
      "node",
      "--hostname",
      "127.0.0.1",
      "--port",
      "18545",
    ],
    { stdio: "ignore" },
  );
  let p;
  try {
    // Espera que JSON-RPC confirme la red de desarrollo antes de enviar transacciones.
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        const r = await fetch("http://127.0.0.1:18545", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_chainId",
            params: [],
          }),
        });
        ready = (await r.json()).result === "0x7a69";
        if (ready) break;
      } catch {
        // El nodo puede tardar en iniciar; se vuelve a consultar en el siguiente intento.
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(ready, true);
    // Despliega token y comercio en la red de prueba recién iniciada.
    p = new Protocol(root, "http://127.0.0.1:18545");
    await p.init();
    // Modelo simulado que siempre genera un resumen y lo aprueba.
    const good = {
      async ask(k) {
        return k === "summary"
          ? {
              summary:
                "Ethereum permite registrar acuerdos y ejecutar pagos con contratos.",
            }
          : {
              decision: "approve",
              spanish: true,
              faithful: true,
              confidence: 0.99,
              reason: "Fixture de prueba",
            };
      },
    };
    // Verifica pago real de 10 CAMPUS y garantía vacía al completar.
    const first = await runAutonomous({
      root,
      publisher: {
        async publish() {
          return {
            cid: "fixture",
            uri: "ipfs://fixture",
            url: "https://example.invalid/fixture",
          };
        },
      },
      id: "exito",
      text: "Texto de prueba",
      model: good,
      protocol: p,
    });
    assert.equal(first.status, "completed");
    // Comprueba que la URI está en calldata del contrato real, sin cambiar Solidity.
    const delivery = first.transactions.find((tx) => tx.label === "Entregar hash");
    const tx = await p.rpc.getTransaction(delivery.hash);
    const decoded = p.acp.interface.parseTransaction({ data: tx.data });
    assert.equal(toUtf8String(decoded.args[2]), "ipfs://fixture");
    assert.equal(decoded.args[1], first.summaryHash);
    assert.equal(await p.state(first.jobId), 3);
    assert.equal(first.balances.provider, "10.0");
    assert.equal(first.balances.escrow, "0.0");
    // Repite el mismo ID y comprueba que el proveedor no cobre dos veces.
    await runAutonomous({
      root,
      id: "exito",
      text: "Texto de prueba",
      model: good,
      protocol: p,
    });
    assert.equal((await p.balances()).provider, "10.0");
    // Modelo simulado que rechaza la fidelidad del resumen.
    const bad = {
      async ask(k) {
        return k === "summary"
          ? { summary: "Resultado incorrecto." }
          : {
              decision: "reject",
              spanish: true,
              faithful: false,
              confidence: 0.99,
              reason: "Fixture de rechazo",
            };
      },
    };
    // Verifica devolución real: el cliente recupera el depósito del segundo encargo.
    const second = await runAutonomous({
      root,
      id: "rechazo",
      text: "Otro texto",
      model: bad,
      protocol: p,
    });
    assert.equal(second.status, "rejected");
    assert.equal(await p.state(second.jobId), 4);
    assert.equal(second.balances.client, "990.0");
    assert.equal(second.balances.escrow, "0.0");
    // Simula caída del proveedor de IA después de financiar; también debe devolver.
    const third = await runAutonomous({
      root,
      id: "error",
      text: "Tercer texto",
      model: {
        async ask() {
          throw Error("Fixture: proveedor caído");
        },
      },
      protocol: p,
    });
    assert.equal(third.status, "rejected");
    assert.equal(third.balances.client, "990.0");
    assert.equal(third.balances.provider, "10.0");
    // Cierra RPC, detiene solo el nodo iniciado por esta prueba y borra su carpeta temporal.
  } finally {
    p?.close();
    child.kill("SIGTERM");
    await fs.rm(root, { recursive: true, force: true });
  }
});
