/** Estados del contrato de referencia y su interpretación en la aplicación. */
// Estos números deben coincidir con el enum JobStatus del contrato Solidity.
export const JOB_STATUS = Object.freeze({
  OPEN: 0,
  FUNDED: 1,
  SUBMITTED: 2,
  COMPLETED: 3,
  REJECTED: 4,
  EXPIRED: 5,
});

// Una cadena terminal indica que ya se resolvió el encargo. undefined significa
// que sigue pendiente y no puede presentarse como pagado o devuelto.
export function terminalStatus(state) {
  return {
    [JOB_STATUS.COMPLETED]: "completed",
    [JOB_STATUS.REJECTED]: "rejected",
    [JOB_STATUS.EXPIRED]: "expired",
  }[state];
}
