/** Preparación y diagnóstico de Sepolia sin consultar al modelo de IA. */
import fs from "node:fs/promises";
import { SepoliaProtocol } from "../../infrastructure/ethereum/sepolia-protocol.mjs";
import {
  loadSepoliaConfig,
  publicError,
} from "../../infrastructure/config/sepolia-config.mjs";
const action = process.argv[2] || "doctor";
let protocol;
try {
  const root = process.cwd();
  protocol = new SepoliaProtocol(root, loadSepoliaConfig(root));
  if (action === "doctor") {
    // Solo lee red y saldos; jamás despliega ni transfiere fondos.
    const accounts = await protocol.doctor();
    console.log(
      JSON.stringify({ network: "Sepolia", chainId: "11155111", accounts }, null, 2),
    );
    if (accounts.some((account) => account.gasETH === "0.0"))
      console.log(
        "Falta ETH de Sepolia para gas en alguna cuenta. Usá un faucet o sepolia:fund-roles.",
      );
  } else if (action === "deploy") {
    // Este paso publica CAMPUS y los contratos; queda separado de la primera consulta de IA.
    await fs.access("build/AgenticCommerce.json").catch(() => {
      throw Error("Ejecutá npm run compile antes de desplegar.");
    });
    await protocol.init();
    console.log(
      "Contratos listos. Direcciones y recibos: data/sepolia/deployment.json",
    );
  } else if (action === "fund-roles") {
    // El usuario ejecuta este comando solo si quiere aportar gas desde la cuenta cliente.
    await protocol.fundRoles();
  } else throw Error("Comando de Sepolia desconocido.");
} catch (error) {
  console.error(publicError(error));
  process.exitCode = 1;
} finally {
  protocol?.close();
}
