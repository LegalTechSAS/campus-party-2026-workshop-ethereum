/** Adaptador de huellas compatible con los valores bytes32 de Ethereum. */
import { keccak256, toUtf8Bytes } from "ethers";
// Convierte texto en bytes UTF-8 y calcula su huella; no cifra ni oculta un secreto.
export const hashText = (text) => keccak256(toUtf8Bytes(text));
