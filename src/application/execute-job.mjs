/**
 * Caso de uso: resolver un encargo autónomo con presupuesto limitado.
 * Depende de reglas de dominio y de puertos recibidos por parámetro.
 * No importa Node, ethers, archivos ni ninguna CLI de IA.
 */
import {
  POLICY,
  acceptable,
  validateRequest,
  reserveBudget,
} from "../domain/policy.mjs";
import { JOB_STATUS, terminalStatus } from "../domain/job-status.mjs";

// Ejecuta un pedido de principio a fin. model y protocol se reciben como
// dependencias para poder sustituirlos por dobles controlados en las pruebas.
/**
 * @param {import('./ports.mjs').JobDependencies} dependencies - Servicios inyectados.
 * @returns {Promise<import('./ports.mjs').RunRecord>} Historial final del pedido.
 */
export async function executeJob({
  text,
  id,
  repository,
  model,
  protocol,
  hash,
  logger,
  publisher,
  describeError = (error) => error.message,
}) {
  validateRequest(text, id);
  await repository.ensure(id);
  let run = await repository.load(id);
  if (!run)
    run = {
      id,
      inputHash: hash(text),
      policy: POLICY,
      status: "running",
      attempts: [],
      transactions: [],
    };
  // No permite reutilizar un identificador con un texto diferente.
  if (run.inputHash !== hash(text)) throw Error("El ID ya corresponde a otro texto.");
  // Un pedido ya resuelto devuelve su registro: no vuelve a generar ni a pagar.
  if (!["running", "needs-recovery"].includes(run.status)) return run;
  // Detecta una dirección de contrato distinta al reanudar. No prueba por sí solo
  // que Hardhat no haya reiniciado: una dirección podría repetirse tras un reinicio.
  if (run.contract && run.contract !== protocol.address)
    throw Error("Cambió el contrato o la red local: no se reanuda este encargo.");
  if (run.chainId && run.chainId !== String(protocol.chainId))
    throw Error("El pedido pertenece a otra red.");
  run.chainId = protocol.chainId?.toString();
  run.contract = protocol.address;
  run.status = "running";
  // Las reglas calculan la reserva; el puerto decide cómo almacenarla.
  const budget = await repository.loadBudget();
  const reserved = reserveBudget(budget, id);
  if (reserved !== budget) await repository.saveBudget(reserved);
  await repository.saveInput(id, text);
  await repository.save(id, run);
  try {
    // Crea el encargo solo si todavía no hay un ID registrado. La descripción incluye
    // la huella de entrada, no su contenido. Un corte antes de guardar exige revisión.
    if (!run.jobId) {
      const created = await protocol.create(
        "Resumen en español, máximo 100 palabras, fiel al original. Input " +
          run.inputHash,
      );
      run.jobId = created.id;
      run.transactions.push(created.evidence);
      await repository.save(id, run);
    }
    // Consulta el estado real antes de repetir operaciones. Los estados 3, 4 y 5
    // son terminales: completado, rechazado y vencido, respectivamente.
    const existing = await protocol.state(run.jobId);
    if (terminalStatus(existing)) {
      run.status = terminalStatus(existing);
      // Registra los saldos al finalizar para mostrar el efecto económico del pedido.
      run.balances = await protocol.balances();
      await repository.save(id, run);
      return run;
    }
    // Deposita el presupuesto; el adaptador omite este paso si ya estaba financiado.
    run.transactions.push(...(await protocol.fund(run.jobId)));
    await repository.save(id, run);
    // El estado 2 significa entrega registrada: al reanudar no se genera otro resumen.
    if (existing !== JOB_STATUS.SUBMITTED) {
      await prepareDelivery({
        run,
        text,
        id,
        model,
        repository,
        protocol,
        hash,
        logger,
        publisher,
      });
    }
    // Antes de pagar verifica que el texto siga coincidiendo con la huella entregada.
    if (run.approved && hash(run.summary) === run.summaryHash) {
      // La razón on-chain es una huella de la evaluación y del hash del resumen.
      const reason = hash(
        JSON.stringify({
          summaryHash: run.summaryHash,
          evaluation: run.evaluation,
        }),
      );
      run.transactions.push(await protocol.approve(run.jobId, reason));
      run.status = "completed";
    } else {
      // Sin aprobación válida, rechaza y solicita devolver el presupuesto al cliente.
      const evidence = await protocol.reject(
        run.jobId,
        hash("No cumple la política automática"),
      );
      if (evidence) run.transactions.push(evidence);
      run.status = "rejected";
    }
  } catch (e) {
    // Si falló el modelo o una operación, intenta resolver el encargo devolviendo fondos.
    run.error = describeError(e);
    if (run.jobId) {
      try {
        const evidence = await protocol.reject(
          run.jobId,
          hash("Error del proceso: devolución automática"),
        );
        if (evidence) run.transactions.push(evidence);
        const state = await protocol.state(run.jobId);
        run.status = terminalStatus(state) ?? "needs-recovery";
      } catch (refundError) {
        // No afirma devolución si el nodo no permitió confirmarla.
        run.status = "needs-recovery";
        run.refundError = describeError(refundError);
      }
    } else run.status = "error";
  }
  // Guarda primero la resolución confirmada: una falla de lectura de saldos
  // no debe perder la evidencia de un pago, rechazo o recuperación pendiente.
  await repository.save(id, run);
  try {
    run.balances = await protocol.balances();
  } catch (balanceError) {
    run.balanceError = describeError(balanceError);
  }
  await repository.save(id, run);
  logger.log(
    JSON.stringify({
      id: run.id,
      status: run.status,
      jobId: run.jobId,
      balances: run.balances,
      error: run.error,
    }),
  );
  return run;
}

// Coordina generación, evaluación y entrega final. No decide cómo consultar el
// modelo, guardar los archivos o firmar: delega esas acciones a los puertos.
async function prepareDelivery({
  publisher,
  run,
  text,
  id,
  model,
  repository,
  protocol,
  hash,
  logger,
}) {
  // Al reanudar también conserva el último resumen y su conteo para corregirlo.
  const previous = run.attempts.at(-1);
  let feedback = previous
    ? `Resumen anterior (${previous.words} palabras): ${previous.summary}\nEvaluación: ${previous.evaluation.reason}`
    : "";
  // Usa la cantidad de intentos guardados para respetar el máximo también al reanudar.
  for (let i = run.attempts.length; i < POLICY.maxAttempts; i++) {
    logger.log(`Intento ${i + 1}: generando y revisando el resumen`);
    // Primera consulta: producir el resumen, incorporando la corrección anterior.
    const generated = await model.ask("summary", {
      text,
      maxWords: POLICY.maxWords,
      targetWords: { min: 70, max: 90 },
      feedback,
    });
    const candidate = generated.summary?.trim();
    if (typeof candidate !== "string" || candidate.length > 20000)
      throw Error("Resumen de modelo inválido.");
    // Segunda consulta: comparar original y candidato. Ocurre fuera de Ethereum
    // y usa el mismo proveedor, por lo que no equivale a un árbitro independiente.
    // El código cuenta las palabras; el modelo juzga idioma y fidelidad.
    const words = candidate ? candidate.split(/\s+/u).length : 0;
    const evaluation = await model.ask("evaluation", {
      text,
      summary: candidate,
      wordCount: words,
      maxWords: POLICY.maxWords,
    });
    // Conserva evidencia de cada intento antes de tomar la siguiente decisión.
    run.attempts.push({
      summary: candidate,
      evaluation,
      words,
    });
    run.summary = candidate;
    run.summaryHash = hash(candidate);
    run.evaluation = evaluation;
    await repository.save(id, run);
    const approved = acceptable(candidate, evaluation);
    logger.log("Decisión: " + evaluation.decision + "; pago habilitado: " + approved);
    logger.log(`Palabras: ${words}/${POLICY.maxWords}. Motivo: ${evaluation.reason}`);
    // Una aprobación válida o un rechazo definitivo termina el ciclo.
    // Una decisión retry, o una aprobación que incumple límites, permite corregir.
    if (approved || evaluation.decision === "reject") break;
    // Incluye el texto que debe recortar y el conteo exacto, sin truncarlo a ciegas.
    feedback = `Resumen anterior (${words} palabras): ${candidate}\nEvaluación: ${evaluation.reason || "No cumple las condiciones."}\nReescribí el resumen entre 70 y 90 palabras, conservando las ideas principales. Máximo obligatorio: ${POLICY.maxWords} palabras.`;
  }
  // Vuelve a calcular la decisión final y guarda los archivos para inspeccionarlos.
  run.approved = acceptable(run.summary ?? "", run.evaluation ?? {});
  await repository.saveResult(id, run.summary ?? "", run.evaluation);
  await repository.save(id, run);
  // Publicación opcional: persiste el CID antes de firmar para reutilizarlo al reanudar.
  if (publisher && !run.publication) {
    run.publication = await publisher.publish(run.summary);
    await repository.save(id, run);
  }
  if (run.publication) logger.log("Resumen público: " + run.publication.url);
  // El hash queda en el evento y la URI pública en los datos de la transacción.
  if (run.summaryHash) {
    const evidence = await protocol.submit(
      run.jobId,
      run.summaryHash,
      run.publication?.uri,
    );
    if (evidence) run.transactions.push(evidence);
    await repository.save(id, run);
  }
}
