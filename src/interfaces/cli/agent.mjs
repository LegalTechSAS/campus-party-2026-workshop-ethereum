/**
 * Punto de entrada del agente. Lee opciones, prepara modelo y blockchain y elige
 * entre procesar un pedido o esperar una cola. Este proceso corre en la computadora;
 * no es un contrato ni instala por sí mismo un servicio permanente.
 */

import fs from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { createRuntime } from "../../main/create-runtime.mjs";
import { publicError } from "../../infrastructure/config/sepolia-config.mjs";
// promisify permite esperar procesos externos con await.
// Los argumentos posteriores al nombre del script indican el motor y el modo.
const exec = promisify(execFile),
  root = process.cwd(),
  args = process.argv.slice(2),
  watch = args.includes("--watch");
// Lee una opción como --engine cursor; si falta, usa el valor predeterminado.
function option(key, fallback) {
  const i = args.indexOf(key);
  return i < 0 ? fallback : args[i + 1];
}
// Claude es la opción predeterminada; --engine cursor selecciona la alternativa.
const engine = option("--engine", "claude");
const network = option("--network", "sepolia");
const runtime = createRuntime({ root, engine, network });
const { model } = runtime;
// Se distingue el nodo iniciado aquí de un nodo externo para cerrar solo el propio.
let ownedChain,
  protocol,
  stopping = false;
await fs.mkdir("data", { recursive: true });
// El archivo de bloqueo impide dos agentes simultáneos en la misma carpeta.
const lock = "data/agent.lock";
try {
  const old = JSON.parse(await fs.readFile(lock, "utf8"));
  try {
    // La señal 0 solo consulta si el proceso existe: no lo termina.
    process.kill(old.pid, 0);
    throw Error("Ya hay un agente activo en esta carpeta.");
  } catch (e) {
    if (e.code !== "ESRCH") throw e;
    // ESRCH indica que el proceso anterior ya no existe; se retira su bloqueo viejo.
    await fs.unlink(lock);
  }
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
// wx crea el bloqueo de forma exclusiva y falla si otro proceso se adelantó.
const handle = await fs.open(lock, "wx");
await handle.writeFile(JSON.stringify({ pid: process.pid }));
await handle.close();
// Libera la conexión, cierra el nodo propio y elimina el bloqueo al terminar.
const cleanup = async () => {
  protocol?.close();
  if (ownedChain && !ownedChain.killed) ownedChain.kill("SIGTERM");
  await fs.unlink(lock).catch(() => {});
};
// Ctrl+C solicita dejar de recibir pedidos; no interrumpe una transacción en curso.
process.on("SIGINT", () => {
  stopping = true;
});
// La señal de terminación solicita la misma salida ordenada del modo continuo.
process.on("SIGTERM", () => {
  stopping = true;
});
// Comprueba el identificador de red con JSON-RPC, sin enviar transacciones.
// 0x7a69 es 31337 en hexadecimal; otra red hace que el programa se detenga.
async function rpcReady() {
  try {
    const r = await fetch("http://127.0.0.1:8545", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      }),
      signal: AbortSignal.timeout(1000),
    });
    const data = await r.json();
    if (data.result && data.result !== "0x7a69")
      throw Error("El puerto 8545 no tiene la red local 31337.");
    return data.result === "0x7a69";
  } catch (e) {
    if (e.message.includes("no tiene")) throw e;
    return false;
  }
}
try {
  // Se verifica el acceso al modelo antes de crear o financiar un encargo.
  await model.preflight();
  try {
    // Si falta el artefacto principal, se compilan los contratos automáticamente.
    await fs.access("build/AgenticCommerce.json");
  } catch {
    console.log("Compilando contratos...");
    await exec(process.execPath, ["scripts/compile.mjs"], { cwd: root });
  }
  // Reutiliza el nodo local existente; si no responde, inicia uno temporal.
  if (network === "local" && !(await rpcReady())) {
    console.log("Iniciando el nodo local.");
    // La salida del nodo queda en un archivo para no mezclarla con los pasos del agente.
    const fd = openSync("data/chain.log", "a");
    ownedChain = spawn(
      process.execPath,
      ["node_modules/hardhat/dist/src/cli.js", "node", "--hostname", "127.0.0.1"],
      { cwd: root, stdio: ["ignore", fd, fd] },
    );
    closeSync(fd);
    // Espera como máximo unos 30 segundos: 120 consultas separadas por 250 ms.
    for (let i = 0; i < 120 && !(await rpcReady()); i++) {
      if (ownedChain.exitCode !== null)
        throw Error("Hardhat no pudo iniciar. Ver data/chain.log.");
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!(await rpcReady())) throw Error("No se pudo iniciar la red local.");
  }
  // Prepara cuentas y contratos antes de comenzar la parte autónoma.
  protocol = runtime.createProtocol();
  await protocol.init();
  // Modo continuo: consulta la carpeta cada segundo y procesa pedidos secuencialmente.
  if (watch) {
    await fs.mkdir("inbox", { recursive: true });
    await fs.mkdir("processed", { recursive: true });
    console.log(
      "Modo continuo: esperando archivos .txt en inbox/. Ctrl+C para detener.",
    );
    while (!stopping) {
      // Solo acepta nombres simples terminados en .txt; ignora archivos aún incompletos.
      const files = (await fs.readdir("inbox"))
        .filter((n) => /^[a-zA-Z0-9_-]{1,70}\.txt$/u.test(n))
        .sort();
      for (const file of files) {
        if (stopping) break;
        const text = await fs.readFile(path.join("inbox", file), "utf8");
        // Un nombre estable permite reconocer el mismo pedido al reiniciar el trabajador.
        const id = "queue-" + file.slice(0, -4);
        try {
          const j = await runtime.run({ text, id, protocol });
          // Si no se confirmó la resolución, detiene la cola para no ocultar el problema.
          if (j.status === "needs-recovery")
            throw Error(
              "La resolución requiere recuperar el nodo. No se crea otro encargo.",
            );
          // Archiva el archivo después de la ejecución; el detalle queda en data/runs/.
          await fs.rename(path.join("inbox", file), path.join("processed", file));
        } catch (e) {
          console.error(file + ": " + publicError(e));
          throw e;
        }
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  } else {
    // Modo de un pedido: lee el archivo elegido y termina después de resolverlo.
    const input = option("--input", "entrada.txt");
    const text = await fs.readFile(input, "utf8");
    // --id permite retomar un pedido; sin esa opción se crea un identificador nuevo.
    const id = option("--id", "run-" + randomUUID());
    const j = await runtime.run({ text, id, protocol });
    if (j.status === "needs-recovery" || j.status === "error" || j.error)
      // Una salida distinta de cero permite detectar el fallo desde la terminal.
      process.exitCode = 1;
  }
} catch (e) {
  console.error(publicError(e));
  process.exitCode = 1;
} finally {
  await cleanup();
}
