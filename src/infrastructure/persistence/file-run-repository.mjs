/**
 * Adaptador de persistencia en archivos. La aplicación pide guardar o cargar;
 * solo esta clase conoce carpetas, JSON y renombrados del sistema operativo.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { validateRequestId } from "../../domain/policy.mjs";

// Evita dejar un JSON incompleto si se interrumpe la escritura. No coordina
// atómicamente el disco con la blockchain: sigue existiendo una ventana de corte.
async function writeJSON(file, value) {
  const temporary = file + ".tmp";
  await fs.writeFile(temporary, JSON.stringify(value, null, 2));
  await fs.rename(temporary, file);
}

// Un archivo ausente representa un registro aún no creado; otros errores se propagan.
async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return fallback;
  }
}

export class FileRunRepository {
  // La carpeta raíz se inyecta para aislar datos del taller y de cada prueba.
  constructor(root, { namespace } = {}) {
    this.root = root;
    this.dataDirectory = path.join(root, "data", ...(namespace ? [namespace] : []));
  }

  // Valida IDs también en el adaptador para impedir rutas arbitrarias al usarlo solo.
  directory(id) {
    validateRequestId(id);
    return path.join(this.dataDirectory, "runs", id);
  }

  // Prepara la carpeta sin cambiar registros que ya existan.
  async ensure(id) {
    await fs.mkdir(this.directory(id), { recursive: true });
  }

  // Recupera el historial de un pedido; undefined significa que es nuevo.
  async load(id) {
    return readJSON(path.join(this.directory(id), "journal.json"), undefined);
  }

  // Guarda un punto de recuperación después de cada paso relevante.
  async save(id, run) {
    await writeJSON(path.join(this.directory(id), "journal.json"), run);
  }

  // Carga reservas acumuladas; las reglas para modificarlas pertenecen al dominio.
  async loadBudget() {
    return readJSON(path.join(this.dataDirectory, "budget.json"), {
      reserved: 0,
      ids: [],
    });
  }

  // Persiste la reserva calculada por la aplicación. El bloqueo de la CLI asegura
  // una sola ejecución por carpeta; este repositorio no ofrece concurrencia distribuida.
  async saveBudget(budget) {
    await writeJSON(path.join(this.dataDirectory, "budget.json"), budget);
  }

  // Conserva el original fuera de la blockchain para evaluar y revisar el resultado.
  async saveInput(id, text) {
    await fs.writeFile(path.join(this.directory(id), "input.txt"), text);
  }

  // Guarda el contenido final y la evaluación para que inspect muestre su evidencia.
  async saveResult(id, summary, evaluation) {
    await fs.writeFile(path.join(this.directory(id), "resumen.txt"), summary);
    await writeJSON(path.join(this.directory(id), "evaluation.json"), evaluation);
  }
}
