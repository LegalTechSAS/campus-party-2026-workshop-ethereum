/**
 * Pruebas de las decisiones del agente sin blockchain ni proveedor de IA.
 * Los dobles de prueba devuelven respuestas controladas para verificar
 * los límites y las rutas de pago o devolución de manera reproducible.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acceptable, runAutonomous } from "../scripts/autonomy.mjs";
// Evaluación fija favorable: no proviene de una consulta real a un modelo.
const ok = {
  decision: "approve",
  spanish: true,
  faithful: true,
  confidence: 0.99,
  reason: "Correcto",
};
// Doble del protocolo que simula estados y cuenta pagos/devoluciones en memoria.
class FakeProtocol {
  // Inicializa un encargo abierto sin movimientos económicos.
  constructor() {
    this.s = 0;
    this.paid = 0;
    this.refunds = 0;
  }
  // Devuelve un ID y una evidencia ficticios, usados únicamente por estas pruebas.
  async create() {
    return { id: "1", evidence: { label: "fixture" } };
  }
  // Expone el estado simulado para que el ciclo autónomo pueda consultarlo.
  async state() {
    return this.s;
  }
  // Simula que se depositó el presupuesto y cambia a financiado.
  async fund() {
    this.s = 1;
    return [];
  }
  // Simula que la entrega quedó registrada.
  async submit() {
    this.s = 2;
    return {};
  }
  // Registra un pago simulado y marca el encargo como completado.
  async approve() {
    this.s = 3;
    this.paid++;
    return {};
  }
  // Cuenta una devolución simulada y marca el rechazo.
  async reject() {
    this.s = 4;
    this.refunds++;
    return {};
  }
  // Produce saldos didácticos para las aserciones; no son consultas a Ethereum.
  async balances() {
    return { provider: String(this.paid * 10), escrow: "0" };
  }
}
// Aísla el historial de cada prueba en una carpeta temporal independiente.
async function root() {
  return fs.mkdtemp(path.join(os.tmpdir(), "campus-agent-"));
}
// Aunque la evaluación diga aprobar, 101 palabras, falta de fidelidad
// o confianza insuficiente impiden pagar.
test("límites duros bloquean una aprobación de IA inválida", () => {
  assert.equal(acceptable("palabra ".repeat(101), ok), false);
  assert.equal(acceptable("Hola", { ...ok, faithful: false }), false);
  assert.equal(acceptable("Hola", { ...ok, confidence: 0.89 }), false);
  assert.equal(acceptable("Hola", ok), true);
});
// Verifica éxito y que repetir el mismo ID no produzca un segundo pago.
test("éxito autónomo, registro y deduplicación", async () => {
  const r = await root(),
    p = new FakeProtocol(),
    m = {
      // Responde con datos controlados para este escenario, sin llamar a IA.
      async ask(k) {
        return k === "summary" ? { summary: "Resumen fiel en español." } : ok;
      },
    };
  const j = await runAutonomous({
    text: "Entrada de ejemplo",
    id: "uno",
    root: r,
    model: m,
    protocol: p,
  });
  assert.equal(j.status, "completed");
  assert.equal(p.paid, 1);
  await runAutonomous({
    text: "Entrada de ejemplo",
    id: "uno",
    root: r,
    model: m,
    protocol: p,
  });
  assert.equal(p.paid, 1);
  await fs.rm(r, { recursive: true });
});
// La primera evaluación solicita corregir; la segunda aprueba.
// Se esperan exactamente dos intentos y un pago.
test("reintenta y después aprueba", async () => {
  const r = await root(),
    p = new FakeProtocol();
  let evaluations = 0;
  const m = {
    // Alterna la evaluación para provocar el reintento esperado.
    async ask(k) {
      return k === "summary"
        ? { summary: "Resumen." }
        : ++evaluations === 1
          ? { ...ok, decision: "retry", reason: "Mejorar la cobertura" }
          : ok;
    },
  };
  const j = await runAutonomous({
    text: "Entrada",
    id: "dos",
    root: r,
    model: m,
    protocol: p,
  });
  assert.equal(j.attempts.length, 2);
  assert.equal(p.paid, 1);
  await fs.rm(r, { recursive: true });
});
// Agotado el máximo de intentos sin resultado válido, debe devolver y no pagar.
test("dos intentos no válidos terminan en rechazo y devolución", async () => {
  const r = await root(),
    p = new FakeProtocol(),
    m = {
      // Responde con datos controlados para este escenario, sin llamar a IA.
      async ask(k) {
        return k === "summary"
          ? { summary: "Resumen." }
          : { ...ok, decision: "retry", faithful: false };
      },
    };
  const j = await runAutonomous({
    text: "Entrada",
    id: "tres",
    root: r,
    model: m,
    protocol: p,
  });
  assert.equal(j.status, "rejected");
  assert.equal(j.attempts.length, 2);
  assert.equal(p.paid, 0);
  assert.equal(p.refunds, 1);
  await fs.rm(r, { recursive: true });
});
// Simula un proveedor de IA caído después del depósito; debe intentar la devolución.
test("fallo del modelo después de financiar devuelve el presupuesto", async () => {
  const r = await root(),
    p = new FakeProtocol(),
    m = {
      // Provoca el fallo que debe activar el rechazo y la devolución.
      async ask() {
        throw Error("Proveedor no disponible");
      },
    };
  const j = await runAutonomous({
    text: "Entrada",
    id: "cuatro",
    root: r,
    model: m,
    protocol: p,
  });
  assert.equal(j.status, "rejected");
  assert.equal(p.refunds, 1);
  assert.equal(p.paid, 0);
  await fs.rm(r, { recursive: true });
});
// Prepara un historial con el tope ya consumido: el protocolo no debe actuar.
test("no gasta si el límite acumulado ya está agotado", async () => {
  const r = await root(),
    p = new FakeProtocol();
  await fs.mkdir(path.join(r, "data"));
  await fs.writeFile(
    path.join(r, "data/budget.json"),
    JSON.stringify({ reserved: 100, ids: [] }),
  );
  await assert.rejects(
    runAutonomous({
      text: "Entrada",
      id: "cinco",
      root: r,
      model: {},
      protocol: p,
    }),
    /100 CAMPUS/u,
  );
  assert.equal(p.s, 0);
  await fs.rm(r, { recursive: true });
});

// Una lectura fallida después de pagar no debe borrar el estado confirmado.
test("conserva el cierre aunque falle la consulta posterior de saldos", async () => {
  const r = await root();
  class UnavailableBalances extends FakeProtocol {
    // Simula un RPC que deja de responder después de confirmar el pago.
    async balances() {
      throw Error("Lectura de saldos no disponible");
    }
  }
  const p = new UnavailableBalances();
  const m = {
    // Produce un resultado fijo para llegar al cierre favorable.
    async ask(kind) {
      return kind === "summary" ? { summary: "Resumen fiel." } : ok;
    },
  };
  const result = await runAutonomous({
    text: "Entrada",
    id: "saldos",
    root: r,
    model: m,
    protocol: p,
  });
  assert.equal(result.status, "completed");
  assert.equal(result.balanceError, "Lectura de saldos no disponible");
  const saved = JSON.parse(
    await fs.readFile(path.join(r, "data/runs/saldos/journal.json"), "utf8"),
  );
  assert.equal(saved.status, "completed");
  assert.equal(p.paid, 1);
  await fs.rm(r, { recursive: true });
});

// Una entrega extensa debe corregirse con evidencia exacta antes de permitir pagar.
test("corrige un resumen largo con conteo exacto y conserva el límite de pago", async () => {
  const r = await root(),
    p = new FakeProtocol();
  const long = "palabra ".repeat(101).trim();
  let generations = 0;
  const m = {
    async ask(kind, payload) {
      if (kind === "summary") {
        assert.deepEqual(payload.targetWords, { min: 70, max: 90 });
        if (++generations === 1) return { summary: long };
        assert.match(payload.feedback, /101 palabras/u);
        assert.ok(payload.feedback.includes(long));
        assert.match(payload.feedback, /70 y 90/u);
        return { summary: "Resumen corregido y fiel." };
      }
      assert.equal(payload.wordCount, generations === 1 ? 101 : 4);
      // Incluso si la IA aprueba 101 palabras, el código exige la corrección.
      return ok;
    },
  };
  try {
    const j = await runAutonomous({
      text: "Entrada",
      id: "extension",
      root: r,
      model: m,
      protocol: p,
    });
    assert.equal(j.status, "completed");
    assert.deepEqual(
      j.attempts.map((a) => a.words),
      [101, 4],
    );
    assert.equal(p.paid, 1);
    assert.equal(p.refunds, 0);
  } finally {
    await fs.rm(r, { recursive: true });
  }
});

// La publicación precede a la entrega y vincula exactamente el resumen evaluado.
test("publica el resumen final y pasa su URI al protocolo", async () => {
  const r = await root(),
    p = new FakeProtocol();
  const publication = {
    cid: "cid-de-prueba",
    uri: "ipfs://cid-de-prueba",
    url: "https://example.invalid/resumen",
  };
  p.submit = async (id, hash, uri) => {
    assert.equal(uri, publication.uri);
    p.s = 2;
    return {};
  };
  try {
    const j = await runAutonomous({
      text: "Entrada privada",
      id: "ipfs",
      root: r,
      protocol: p,
      model: {
        async ask(kind) {
          return kind === "summary" ? { summary: "Resumen público." } : ok;
        },
      },
      publisher: {
        async publish(summary) {
          assert.equal(summary, "Resumen público.");
          return publication;
        },
      },
    });
    assert.equal(j.status, "completed");
    assert.deepEqual(j.publication, publication);
    assert.equal(p.paid, 1);
  } finally {
    await fs.rm(r, { recursive: true });
  }
});

// No paga una entrega si la publicación solicitada falla.
test("fallo de IPFS devuelve el depósito sin pagar", async () => {
  const r = await root(),
    p = new FakeProtocol();
  try {
    const j = await runAutonomous({
      text: "Entrada",
      id: "ipfs-error",
      root: r,
      protocol: p,
      model: {
        async ask(kind) {
          return kind === "summary" ? { summary: "Resumen." } : ok;
        },
      },
      publisher: {
        async publish() {
          throw Error("IPFS no disponible");
        },
      },
    });
    assert.equal(j.status, "rejected");
    assert.equal(p.refunds, 1);
    assert.equal(p.paid, 0);
  } finally {
    await fs.rm(r, { recursive: true });
  }
});
