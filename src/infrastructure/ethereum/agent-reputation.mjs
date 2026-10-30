/** Adaptador ERC-8004: registros oficiales de Sepolia, separados del comercio. */
import fs from "node:fs/promises";
import path from "node:path";
import { Contract, formatUnits, keccak256, toUtf8Bytes } from "ethers";
export const IDENTITY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
export const REPUTATION = "0x8004B663056A597Dffe9eCcC1965A193B7388713";
export const IDENTITY_ABI = [
  "function register(string agentURI) returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "event Registered(uint256 indexed agentId,string agentURI,address indexed owner)",
];
export const REPUTATION_ABI = [
  "function getIdentityRegistry() view returns (address)",
  "function giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)",
  "function getSummary(uint256,address[],string,string) view returns (uint64,int128,uint8)",
  "function getLastIndex(uint256,address) view returns (uint64)",
  "function readFeedback(uint256,address,uint64) view returns (int128,uint8,string,string,bool)",
];

export class AgentReputation {
  // Reutiliza firmantes con límites de gas, sin crear otras llaves ni modificar contratos.
  constructor(root, protocol) {
    this.protocol = protocol;
    this.file = path.join(root, "data/sepolia/agent-identity.json");
    this.identity = new Contract(IDENTITY, IDENTITY_ABI, protocol.provider);
    this.registry = new Contract(REPUTATION, REPUTATION_ABI, protocol.evaluator);
  }

  // Comprueba red y vínculo de los registros antes de firmar cualquier operación.
  async check() {
    if ((await this.protocol.rpc.getNetwork()).chainId !== 11155111n)
      throw Error("ERC-8004 requiere Sepolia 11155111.");
    for (const address of [IDENTITY, REPUTATION])
      if ((await this.protocol.rpc.getCode(address)) === "0x")
        throw Error("Registro ERC-8004 ausente.");
    if (
      (await this.registry.getIdentityRegistry()).toLowerCase() !==
      IDENTITY.toLowerCase()
    )
      throw Error("El registro de reputación usa otra identidad.");
  }

  // El archivo contiene solo identidad pública; nunca claves privadas.
  async load() {
    const record = JSON.parse(await fs.readFile(this.file, "utf8"));
    const owner = await this.identity.ownerOf(record.agentId);
    if (
      owner.toLowerCase() !== (await this.protocol.provider.getAddress()).toLowerCase()
    )
      throw Error("La identidad ya no pertenece al proveedor configurado.");
    return record;
  }

  // Registro explícito y reutilizable: el proveedor es dueño del NFT de identidad.
  async register() {
    await this.check();
    try {
      return await this.load();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const metadata = {
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "CAMPUS · Agente de resúmenes",
      description:
        "Agente educativo local. Genera resúmenes en español y liquida encargos en Sepolia.",
      active: true,
      services: [],
      supportedTrust: ["reputation"],
    };
    const uri =
      "data:application/json;base64," +
      Buffer.from(JSON.stringify(metadata)).toString("base64");
    const { r, evidence } = await this.protocol.tx(
      "Registrar identidad ERC-8004",
      this.identity.register(uri),
    );
    const event = r.logs
      .map((log) => {
        try {
          return this.identity.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((log) => log?.name === "Registered");
    if (!event)
      throw Error(
        "No se encontró la identidad registrada; revisar el recibo antes de repetir.",
      );
    const record = {
      agentId: event.args.agentId.toString(),
      identityRegistry: IDENTITY,
      reputationRegistry: REPUTATION,
      owner: await this.protocol.provider.getAddress(),
      transaction: evidence,
    };
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(record, null, 2));
    return record;
  }

  // Solo califica resultados evaluados y resueltos: los errores de IPFS/red no son mala calidad.
  async record(run) {
    if (
      run.reputation ||
      run.error ||
      !run.evaluation ||
      !["completed", "rejected"].includes(run.status)
    )
      return null;
    await this.check();
    const agent = await this.load();
    const endpoint = `eip155:11155111:${run.contract}/jobs/${run.jobId}`;
    const value = run.status === "completed" ? 100 : 0;
    const feedbackHash = keccak256(
      toUtf8Bytes(
        JSON.stringify({
          jobId: run.jobId,
          summaryHash: run.summaryHash,
          evaluation: run.evaluation,
        }),
      ),
    );
    // El evaluador firma: es otra wallet, pero en el taller la controla el mismo docente.
    // Guarda el hash antes de esperar: reanudar no envía un segundo feedback.
    const receiptFile = path.join(path.dirname(this.file), `feedback-${run.id}.json`);
    let pending;
    try {
      pending = JSON.parse(await fs.readFile(receiptFile, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (
      pending &&
      (pending.agentId !== agent.agentId || pending.feedbackHash !== feedbackHash)
    )
      throw Error("El feedback pendiente corresponde a otra identidad o resultado.");
    let evidence;
    if (pending) {
      const receipt = await this.protocol.rpc.getTransactionReceipt(pending.hash);
      if (!receipt)
        throw Error("Feedback enviado pero todavía sin confirmación; no se duplica.");
      if (receipt.status !== 1)
        throw Error("La transacción de feedback falló; revisar antes de reenviar.");
      evidence = {
        label: "Registrar reputación ERC-8004",
        hash: pending.hash,
        block: receipt.blockNumber,
        url: `https://sepolia.etherscan.io/tx/${pending.hash}`,
      };
    } else {
      const tx = await this.registry.giveFeedback(
        agent.agentId,
        value,
        0,
        "campus-summary",
        "quality",
        endpoint,
        "",
        feedbackHash,
      );
      await fs.mkdir(path.dirname(receiptFile), { recursive: true });
      await fs.writeFile(
        receiptFile,
        JSON.stringify({ hash: tx.hash, agentId: agent.agentId, feedbackHash }),
      );
      ({ evidence } = await this.protocol.tx(
        "Registrar reputación ERC-8004",
        Promise.resolve(tx),
      ));
    }
    return { agentId: agent.agentId, value, transaction: evidence };
  }

  // Consulta solo al evaluador del taller; no presenta esto como una puntuación global.
  async read() {
    await this.check();
    const agent = await this.load(),
      evaluator = await this.protocol.evaluator.getAddress();
    const [count, value, decimals] = await this.registry.getSummary(
      agent.agentId,
      [evaluator],
      "campus-summary",
      "quality",
    );
    return {
      ...agent,
      evaluator,
      feedbackCount: count.toString(),
      averageScore: count ? formatUnits(value, decimals) : null,
      scale: "0–100",
      scope: "Evaluaciones de la wallet del taller. No incluye otros evaluadores.",
      explorer: `https://sepolia.etherscan.io/token/${IDENTITY}?a=${agent.agentId}`,
      registry: `https://sepolia.etherscan.io/address/${REPUTATION}#readProxyContract`,
    };
  }
}
