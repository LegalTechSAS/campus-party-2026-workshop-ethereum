/**
 * Puertos del caso de uso. JSDoc documenta los servicios recibidos por parámetros
 * sin acoplar el núcleo a un proveedor o introducir clases abstractas innecesarias.
 * Los adaptadores concretos implementan estas operaciones.
 *
 * @typedef {Object} RunRecord
 * @property {string} id - Identificador local del pedido.
 * @property {string} inputHash - Huella del texto de entrada.
 * @property {string} status - Estado del proceso.
 * @property {Array<Object>} attempts - Candidatos con evaluación y cantidad de palabras.
 * @property {Array<Object>} transactions - Recibos con etiqueta, hash, bloque y gas.
 * @property {string} [jobId] - Identificador del encargo en el contrato.
 * @property {string} [contract] - Dirección del contrato utilizado.
 * @property {string} [summary] - Último resumen generado.
 * @property {string} [summaryHash] - Huella del resumen.
 * @property {{cid: string, uri: string, url: string}} [publication] - Referencia pública del resumen en IPFS.
 * @property {Object} [evaluation] - Decisión, idioma, fidelidad, confianza y motivo.
 * @property {boolean} [approved] - Resultado de aplicar las reglas al candidato.
 * @property {Object<string,string>} [balances] - Saldos al consultar el cierre.
 * @property {string} [balanceError] - Fallo al leer saldos después de resolver.
 * @property {string} [error] - Motivo de fallo, si ocurrió.
 *
 * @typedef {Object} RunRepository
 * @property {(id: string) => Promise<void>} ensure - Prepara el almacenamiento.
 * @property {(id: string) => Promise<RunRecord|undefined>} load - Recupera un pedido.
 * @property {(id: string, run: RunRecord) => Promise<void>} save - Guarda un avance.
 * @property {() => Promise<{reserved: number, ids: Array<string>}>} loadBudget - Lee reservas.
 * @property {(budget: Object) => Promise<void>} saveBudget - Guarda reservas acumuladas.
 * @property {(id: string, text: string) => Promise<void>} saveInput - Guarda el original.
 * @property {(id: string, summary: string, evaluation: Object) => Promise<void>} saveResult - Guarda la entrega.
 *
 * @typedef {Object} LanguageModel
 * @property {(kind: string, payload: Object) => Promise<Object>} ask - Devuelve resumen o evaluación.
 *
 * @typedef {Object} CommerceProtocol
 * @property {string} address - Dirección del contrato que maneja el pedido.
 * @property {(description: string) => Promise<{id: string, evidence: Object}>} create - Crea un encargo.
 * @property {(id: string) => Promise<number>} state - Consulta el estado.
 * @property {(id: string) => Promise<Array<Object>>} fund - Deposita el presupuesto.
 * @property {(id: string, hash: string, uri?: string) => Promise<Object|null>} submit - Registra una entrega.
 * @property {(id: string, reason: string) => Promise<Object>} approve - Completa y paga.
 * @property {(id: string, reason: string) => Promise<Object|null>} reject - Rechaza o reclama devolución.
 * @property {() => Promise<Object<string,string>>} balances - Consulta saldos.
 *
 * @typedef {Object} JobDependencies
 * @property {string} text - Texto del pedido.
 * @property {string} id - Identificador estable.
 * @property {RunRepository} repository - Puerto de persistencia.
 * @property {{publish: (summary: string) => Promise<{cid: string, uri: string, url: string}>}} [publisher] - Puerto opcional de publicación pública.
 * @property {LanguageModel} model - Puerto de generación y evaluación.
 * @property {CommerceProtocol} protocol - Puerto de comercio.
 * @property {(text: string) => string} hash - Calculador de huellas.
 * @property {(error: Error) => string} [describeError] - Mensaje público sin secretos.
 * @property {{log: (message: string) => void}} logger - Destino de mensajes.
 */
export {};
