/** Configuración privada del taller en Sepolia, separada del código y de las diapositivas. */
import path from "node:path";
import { loadEnvFile } from "node:process";
import { Wallet, parseEther, parseUnits } from "ethers";

// Lee solo el .env de esta carpeta. Las variables ya exportadas tienen prioridad.
// Este método no muestra valores ni solicita llaves por terminal o por chat.
export function loadSepoliaConfig(root = process.cwd(), environment) {
  if (!environment) {
    try {
      loadEnvFile(path.join(root, ".env"));
    } catch (error) {
      if (error.code !== "ENOENT")
        throw Error("No se pudo leer .env.", { cause: error });
    }
    environment = process.env;
  }
  const rpcURL =
    environment.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
  let url;
  try {
    url = new URL(rpcURL);
  } catch {
    throw Error("SEPOLIA_RPC_URL debe ser una URL HTTPS válida.");
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw Error(
      "SEPOLIA_RPC_URL requiere HTTPS sin credenciales dentro de usuario/contraseña.",
    );
  const keys = [
    "CLIENT_PRIVATE_KEY",
    "PROVIDER_PRIVATE_KEY",
    "EVALUATOR_PRIVATE_KEY",
  ].map((name) => {
    const value = environment[name]?.trim();
    if (!/^(?:0x)?[0-9a-fA-F]{64}$/u.test(value || ""))
      throw Error(
        `Configurá ${name} en .env con una llave de prueba. No la compartas por chat.`,
      );
    const key = value.startsWith("0x") ? value : `0x${value}`;
    try {
      new Wallet(key);
    } catch {
      throw Error(`${name} no es una llave privada válida.`);
    }
    return key;
  });
  const addresses = keys.map((key) => new Wallet(key).address);
  if (new Set(addresses.map((address) => address.toLowerCase())).size !== 3)
    throw Error("Cliente, proveedor y evaluador deben ser tres cuentas distintas.");
  // Estos límites afectan el gas pagado en ETH de prueba, no el precio de 10 CAMPUS.
  const maxFeeGwei = environment.SEPOLIA_MAX_FEE_GWEI || "20";
  const maxTxCostETH = environment.SEPOLIA_MAX_TX_COST_ETH || "0.05";
  let maxFeePerGas, maxTxCost;
  try {
    maxFeePerGas = parseUnits(maxFeeGwei, "gwei");
    maxTxCost = parseEther(maxTxCostETH);
  } catch {
    throw Error("Los límites de gas deben ser números decimales válidos.");
  }
  if (maxFeePerGas <= 0n || maxTxCost <= 0n)
    throw Error("Los límites de gas deben ser positivos.");
  return { rpcURL, keys, addresses, maxFeePerGas, maxTxCost, confirmations: 1 };
}

// Evita que una excepción de ethers o HTTP muestre la URL privada o una llave.
export function publicError(error) {
  let message = error.shortMessage || error.message || "Error de conexión u operación.";
  for (const name of [
    "SEPOLIA_RPC_URL",
    "CLIENT_PRIVATE_KEY",
    "PROVIDER_PRIVATE_KEY",
    "EVALUATOR_PRIVATE_KEY",
    "ANTHROPIC_API_KEY",
    "PINATA_JWT",
    "PINATA_API_KEY",
    "PINATA_API_SECRET",
  ]) {
    const secret = process.env[name];
    if (secret) message = message.replaceAll(secret, "[valor privado]");
  }
  return message
    .replace(/https?:\/\/[^\s"')]+/gu, "[RPC]")
    .replace(/0x[0-9a-fA-F]{64}/gu, "[huella o llave omitida]");
}
