/**
 * Composición: conecta el caso de uso con persistencia y huellas concretas.
 * Cambiar el almacenamiento no exige modificar las reglas del dominio.
 */
import { executeJob } from "../application/execute-job.mjs";
import { FileRunRepository } from "../infrastructure/persistence/file-run-repository.mjs";
import { publicError } from "../infrastructure/config/sepolia-config.mjs";
import { hashText } from "../infrastructure/crypto/keccak-hasher.mjs";

// La CLI y las pruebas pueden inyectar modelo, protocolo y registro de mensajes.
// La implementación concreta del repositorio también puede sustituirse.
export async function runAutonomous({
  text,
  id,
  root,
  model,
  protocol,
  reputation,
  publisher,
  repository = new FileRunRepository(root, { namespace: protocol.storageNamespace }),
  logger = console,
}) {
  const run = await executeJob({
    text,
    id,
    model,
    protocol,
    publisher,
    repository,
    hash: hashText,
    describeError: publicError,
    logger,
  });
  // Reputación es posterior al pago: un fallo nunca revierte ni cambia su resultado.
  if (reputation) {
    try {
      const evidence = await reputation.record(run);
      if (evidence) run.reputation = evidence;
      delete run.reputationError;
    } catch (error) {
      run.reputationError = publicError(error);
      logger.log("No se pudo registrar la reputación: " + run.reputationError);
    }
    await repository.save(id, run);
  }
  return run;
}
