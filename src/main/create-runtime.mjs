/** Composición: selecciona red, proveedor de IA y adaptadores concretos. */
import { AgentReputation } from "../infrastructure/ethereum/agent-reputation.mjs";
import { IpfsPublisher } from "../infrastructure/storage/ipfs-publisher.mjs";
import { Model } from "../infrastructure/ai/model.mjs";
import { Protocol } from "../infrastructure/ethereum/protocol.mjs";
import { SepoliaProtocol } from "../infrastructure/ethereum/sepolia-protocol.mjs";
import { loadSepoliaConfig } from "../infrastructure/config/sepolia-config.mjs";
import { runAutonomous } from "./run-autonomous.mjs";

// Sepolia es la ruta principal. Local permanece disponible para pruebas sin fondos.
export function createRuntime({ root, engine, network = "sepolia" }) {
  if (!["sepolia", "local"].includes(network))
    throw Error("Red válida: sepolia o local.");
  const config = network === "sepolia" ? loadSepoliaConfig(root) : undefined;
  // La opción requiere activación explícita: los resúmenes publicados son públicos.
  const publicationMode = process.env.PUBLISH_TO_IPFS || "false";
  if (!["true", "false"].includes(publicationMode))
    throw Error("PUBLISH_TO_IPFS debe ser true o false.");
  const publisher =
    publicationMode === "true"
      ? new IpfsPublisher({
          jwt: process.env.PINATA_JWT,
          apiKey: process.env.PINATA_API_KEY,
          apiSecret: process.env.PINATA_API_SECRET,
        })
      : undefined;
  const model = new Model(engine);
  return {
    model,
    network,
    // El protocolo se conecta cuando la interfaz ya está preparada para usarlo.
    createProtocol() {
      return network === "sepolia"
        ? new SepoliaProtocol(root, config)
        : new Protocol(root);
    },
    // El caso de uso permanece igual; la red solo cambia los adaptadores inyectados.
    run({ text, id, protocol }) {
      return runAutonomous({
        text,
        id,
        root,
        model,
        protocol,
        publisher,
        reputation:
          network === "sepolia" ? new AgentReputation(root, protocol) : undefined,
      });
    },
  };
}
