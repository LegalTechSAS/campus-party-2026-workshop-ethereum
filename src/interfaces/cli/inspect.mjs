/**
 * Muestra el último registro local del agente para observar su resultado.
 * Los saldos corresponden al momento registrado; este comando no consulta
 * la blockchain ni vuelve a ejecutar el pedido.
 */

import fs from "node:fs/promises";
import path from "node:path";
// La fuente es el historial local, no una llamada RPC al contrato.
const local = process.argv.includes("--local");
const dir = local ? "data/runs" : "data/sepolia/runs";
try {
  // Recorre carpetas de pedidos y omite entradas sin un registro válido.
  const ids = await fs.readdir(dir);
  const journals = await Promise.all(
    ids.map(async (id) => {
      const file = path.join(dir, id, "journal.json");
      try {
        return {
          j: JSON.parse(await fs.readFile(file, "utf8")),
          mtime: (await fs.stat(file)).mtimeMs,
        };
      } catch {
        return null;
      }
    }),
  );
  // Selecciona el registro modificado más recientemente.
  const latest = journals.filter(Boolean).sort((a, b) => b.mtime - a.mtime)[0];
  if (!latest) throw Error("Todavía no hay pedidos.");
  // Muestra un resumen y la ruta donde inspeccionar el contenido completo.
  const j = latest.j;
  console.log(
    JSON.stringify(
      {
        id: j.id,
        status: j.status,
        jobId: j.jobId,
        attempts: j.attempts.length,
        balancesAtResolution: j.balances,
        transactions: j.transactions,
        publication: j.publication,
        reputation: j.reputation,
        reputationError: j.reputationError,
        error: j.error,
        evidence: path.resolve(dir, j.id),
      },
      null,
      2,
    ),
  );
  // Si todavía no hay pedidos o no se puede leer el historial, termina con error visible.
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
