/** Pruebas del núcleo con puertos en memoria, sin disco, CLI, ethers ni credenciales. */
import test from "node:test";
import assert from "node:assert/strict";
import { executeJob } from "../src/application/execute-job.mjs";
import { reserveBudget, validateRequest } from "../src/domain/policy.mjs";

// Reservar el mismo ID no aumenta el gasto y la función no modifica la entrada.
test("la reserva es inmutable, idempotente y respeta el tope", () => {
  const previous = { reserved: 90, ids: ["anterior"] };
  const next = reserveBudget(previous, "nuevo");
  assert.equal(previous.reserved, 90);
  assert.equal(next.reserved, 100);
  assert.equal(reserveBudget(next, "nuevo"), next);
  assert.throws(() => reserveBudget(next, "otro"), /100 CAMPUS/u);
});

// Los IDs solo admiten nombres seguros; la entrada debe contener texto.
test("el dominio rechaza rutas y textos vacíos", () => {
  assert.throws(() => validateRequest("Texto", "../otra-carpeta"), /Identificador/u);
  assert.throws(() => validateRequest("   ", "pedido"), /vacío/u);
});

// Sustituir los servicios reales no exige cambiar el código del caso de uso.
test("el caso de uso funciona en memoria y no duplica pagos", async () => {
  const runs = new Map();
  let budget = { reserved: 0, ids: [] },
    state = 0,
    payments = 0;
  const repository = {
    // En memoria no es necesario crear carpetas.
    async ensure() {},
    // Lee una copia para no compartir referencias con el caso de uso.
    async load(id) {
      return structuredClone(runs.get(id));
    },
    // Simula persistencia sin escribir en archivos.
    async save(id, run) {
      runs.set(id, structuredClone(run));
    },
    // Lee la reserva acumulada como un dato independiente.
    async loadBudget() {
      return structuredClone(budget);
    },
    // Conserva una copia de la nueva reserva.
    async saveBudget(value) {
      budget = structuredClone(value);
    },
    // El original no necesita almacenarse en este escenario de prueba.
    async saveInput() {},
    // La prueba de integración con archivos verifica la entrega persistida.
    async saveResult() {},
  };
  const protocol = {
    address: "contrato-simulado",
    // Crea un encargo ficticio, sin enviar ninguna transacción.
    async create() {
      return { id: "1", evidence: { label: "simulación" } };
    },
    // Expone el estado simulado del contrato.
    async state() {
      return state;
    },
    // Cambia el encargo a financiado.
    async fund() {
      state = 1;
      return [];
    },
    // Cambia el encargo a entregado.
    async submit() {
      state = 2;
      return {};
    },
    // Cuenta pagos para detectar una ejecución duplicada.
    async approve() {
      state = 3;
      payments++;
      return {};
    },
    // Este escenario favorable no debe terminar en un rechazo.
    async reject() {
      throw Error("No debe rechazar este resultado");
    },
    // Devuelve saldos simulados, no una consulta de red.
    async balances() {
      return { provider: String(payments * 10), escrow: "0" };
    },
  };
  const model = {
    // Responde con resumen y evaluación fijos para un resultado reproducible.
    async ask(kind) {
      return kind === "summary"
        ? { summary: "Resumen de prueba." }
        : {
            decision: "approve",
            spanish: true,
            faithful: true,
            confidence: 0.99,
            reason: "Evaluación simulada",
          };
    },
  };
  const input = {
    text: "Entrada de prueba",
    id: "memoria",
    repository,
    protocol,
    model,
    // La huella ficticia permite probar el puerto sin depender de ethers.
    hash: (text) => "huella:" + text,
    // Silencia mensajes de la prueba sin usar la terminal desde la aplicación.
    logger: { log() {} },
  };
  assert.equal((await executeJob(input)).status, "completed");
  await executeJob(input);
  assert.equal(payments, 1);
  assert.equal(budget.reserved, 10);
});
