/**
 * Dominio: reglas puras del taller. No importa archivos, modelos, Ethereum ni Node.
 * Puede probarse con valores en memoria, sin conexión ni credenciales.
 */

// Política que el modelo no puede modificar a través de sus respuestas.
// Los valores de presupuesto se expresan en CAMPUS, no en unidades mínimas ERC-20.
export const POLICY = Object.freeze({
  // Presupuesto fijo por encargo.
  budget: 10,
  // Tope acumulado reservado, incluso para encargos luego rechazados.
  maxTotalBudget: 100,
  // Una generación inicial y, como máximo, una corrección.
  maxAttempts: 2,
  // El código cuenta palabras separadas por espacios en blanco.
  maxWords: 100,
  // Límite de tamaño de entrada medido como longitud de cadena en JavaScript.
  maxInputChars: 20000,
  // Umbral de confianza declarada por el modelo: no es una garantía de precisión.
  minConfidence: 0.9,
});

// Combina el límite verificable de palabras con el juicio semántico del modelo.
// Aunque el modelo diga approve, el código bloquea un texto que supere el límite.
export function acceptable(text, e) {
  const words = text.trim() ? text.trim().split(/\s+/u).length : 0;
  return (
    words > 0 &&
    words <= POLICY.maxWords &&
    e.decision === "approve" &&
    e.spanish === true &&
    e.faithful === true &&
    Number.isFinite(e.confidence) &&
    e.confidence >= POLICY.minConfidence
  );
}

// Comprueba el tamaño y el ID antes de permitir persistencia o acciones económicas.
export function validateRequest(text, id) {
  if (typeof text !== "string" || !text.trim() || text.length > POLICY.maxInputChars)
    throw Error("Texto vacío o mayor de 20.000 caracteres.");
  validateRequestId(id);
}

// Un identificador es un nombre lógico del pedido, no una ruta de archivos.
export function validateRequestId(id) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/u.test(id)) throw Error("Identificador inválido.");
}

// Devuelve una nueva reserva sin mutar el historial recibido. Un ID ya reservado
// no vuelve a consumir presupuesto, y una devolución no libera el límite acumulado.
export function reserveBudget(budget, id) {
  if (budget.ids.includes(id)) return budget;
  if (budget.reserved + POLICY.budget > POLICY.maxTotalBudget)
    throw Error("Límite acumulado de 100 CAMPUS alcanzado.");
  return { reserved: budget.reserved + POLICY.budget, ids: [...budget.ids, id] };
}
