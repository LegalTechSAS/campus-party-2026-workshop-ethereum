/**
 * Agrega un archivo de texto a la cola que observa npm run worker.
 * Agregar un pedido no ejecuta el agente: el trabajador debe estar activo.
 */

import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
// Permite elegir el archivo: npm run enqueue -- otro-texto.txt.
const source = process.argv[2] || "entrada.txt";
const text = await fs.readFile(source, "utf8");
// Valida la entrada antes de incorporarla a la cola.
if (!text.trim() || text.length > 20000)
  throw Error("Entrada vacía o mayor de 20.000 caracteres.");
await fs.mkdir("inbox", { recursive: true });
// El identificador aleatorio evita sobreescribir otro pedido con el mismo nombre.
const id = "pedido-" + randomUUID();
// Escribe primero con extensión .pending; el trabajador solo observa .txt.
// La opción wx impide reemplazar un archivo existente.
await fs.writeFile("inbox/" + id + ".pending", text, { flag: "wx" });
// Publica el pedido completo en la cola mediante un renombrado.
await fs.rename("inbox/" + id + ".pending", "inbox/" + id + ".txt");
console.log("Pedido en cola: " + id);
