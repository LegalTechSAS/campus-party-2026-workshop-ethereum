/**
 * Puente entre JavaScript y Ethereum mediante ethers.
 * Cada operación elige la cuenta que corresponde al rol del contrato.
 * El adaptador base usa Hardhat; Sepolia sustituye la conexión y los firmantes.
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  JsonRpcProvider,
  Contract,
  ContractFactory,
  Interface,
  ZeroAddress,
  parseEther,
  formatEther,
  hexlify,
  toUtf8Bytes,
} from "ethers";
// ERC-20 usa enteros en unidades mínimas. Con 18 decimales, parseEther("10")
// representa 10 CAMPUS; el nombre de la función no convierte CAMPUS en ETH.
import { POLICY } from "../../domain/policy.mjs";
export const BUDGET = parseEther(String(POLICY.budget));
// Agrupa operaciones de blockchain y separa sus detalles del ciclo de decisiones.
export class Protocol {
  // La configuración externa permite reutilizar el flujo con firmantes de Sepolia.
  // Sin opciones, conserva el adaptador local que utilizan las pruebas y la ruta manual.
  constructor(root = process.cwd(), rpcURL = "http://127.0.0.1:8545", options = {}) {
    const url = new URL(rpcURL);
    this.chainId = options.chainId ?? 31337n;
    const local = url.protocol === "http:" && url.hostname === "127.0.0.1";
    if (this.chainId === 31337n && !local) throw Error("Solo RPC local 127.0.0.1.");
    if (this.chainId !== 31337n && this.chainId !== 11155111n)
      throw Error("Red no admitida.");
    if (
      this.chainId === 11155111n &&
      url.protocol !== "https:" &&
      !(options.simulation === true && local)
    )
      throw Error("Sepolia requiere RPC HTTPS.");
    this.root = root;
    this.rpc = new JsonRpcProvider(rpcURL, undefined, { cacheTimeout: -1 });
    this.options = options;
    this.storageNamespace = options.storageNamespace;
    this.file = path.join(
      root,
      "data",
      ...(this.storageNamespace ? [this.storageNamespace] : []),
      options.stateFile || "autonomous-chain.json",
    );
    this.explorer = options.explorer;
  }

  // El adaptador local usa las cuentas desbloqueadas del nodo de desarrollo.
  async loadSigners() {
    return Promise.all([0, 1, 2].map((index) => this.rpc.getSigner(index)));
  }

  // Carga o despliega el conjunto de contratos. Cada despliegue confirmado se guarda
  // antes de avanzar al siguiente para poder continuar una preparación interrumpida.
  async init({ deploy = true } = {}) {
    if ((await this.rpc.getNetwork()).chainId !== this.chainId)
      throw Error(`Se requiere chainId ${this.chainId}.`);
    [this.client, this.provider, this.evaluator] = await this.loadSigners();
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    let state;
    try {
      state = JSON.parse(await fs.readFile(this.file, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const accounts = await Promise.all(
      [this.client, this.provider, this.evaluator].map((signer) => signer.getAddress()),
    );
    if (
      state?.accounts &&
      state.accounts.some(
        (address, index) => address.toLowerCase() !== accounts[index].toLowerCase(),
      )
    )
      throw Error(
        "Las cuentas no coinciden con el despliegue guardado. Usá la configuración original.",
      );
    for (const field of ["token", "implementation", "acp"]) {
      if (state?.[field] && (await this.rpc.getCode(state[field])) === "0x") {
        if (this.chainId === 11155111n)
          throw Error(
            "El despliegue guardado no existe en esta red. No se reemplaza automáticamente.",
          );
        state = undefined;
        break;
      }
    }
    state ??= { chainId: this.chainId.toString(), accounts, deployments: [] };
    if (state.chainId && state.chainId !== this.chainId.toString())
      throw Error("El despliegue pertenece a otra red.");
    const save = async () => {
      const temporary = this.file + ".tmp";
      await fs.writeFile(temporary, JSON.stringify(state, null, 2));
      await fs.rename(temporary, this.file);
    };
    for (const name of ["WorkshopToken", "AgenticCommerce", "ERC1967Proxy"]) {
      const field = {
        WorkshopToken: "token",
        AgenticCommerce: "implementation",
        ERC1967Proxy: "acp",
      }[name];
      if (state[field]) continue;
      if (!deploy)
        throw Error("Falta desplegar contratos. Ejecutá npm run sepolia:deploy.");
      const initialization =
        name === "ERC1967Proxy"
          ? new Interface(
              (await this.artifact("AgenticCommerce")).abi,
            ).encodeFunctionData("initialize", [state.token, accounts[2]])
          : undefined;
      const args =
        name === "WorkshopToken"
          ? [accounts[0]]
          : name === "ERC1967Proxy"
            ? [state.implementation, initialization]
            : [];
      const contract = await this.deploy(name, args);
      state[field] = await contract.getAddress();
      state.deployments ??= [];
      state.deployments.push(this.lastDeployment);
      await save();
    }
    // Crea objetos ethers con dirección, ABI y firmante para llamar a los contratos.
    this.address = state.acp;
    this.token = new Contract(
      state.token,
      (await this.artifact("WorkshopToken")).abi,
      this.client,
    );
    this.acp = new Contract(
      state.acp,
      (await this.artifact("AgenticCommerce")).abi,
      this.client,
    );
  }
  // Lee ABI y bytecode generados por npm run compile.
  async artifact(name) {
    return JSON.parse(
      await fs.readFile(path.join(this.root, "build", name + ".json"), "utf8"),
    );
  }
  // Despliega y conserva el recibo para mostrar una evidencia verificable.
  async deploy(name, args) {
    const artifact = await this.artifact(name);
    const contract = await new ContractFactory(
      artifact.abi,
      artifact.bytecode,
      this.client,
    ).deploy(...args);
    const { evidence } = await this.tx(
      "Desplegar " + name,
      Promise.resolve(contract.deploymentTransaction()),
    );
    this.lastDeployment = { name, address: await contract.getAddress(), ...evidence };
    console.log("Desplegado " + name + ": " + (await contract.getAddress()));
    return contract;
  }

  // Espera confirmación y devuelve hash, bloque, gas y enlace del explorador.
  async tx(label, pending) {
    const transaction = await pending;
    const receipt = await transaction.wait(this.options.confirmations ?? 1, 180000);
    const evidence = {
      label,
      hash: receipt.hash,
      block: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      chainId: this.chainId.toString(),
    };
    if (this.explorer) evidence.url = `${this.explorer}/tx/${receipt.hash}`;
    console.log(JSON.stringify(evidence));
    return { r: receipt, evidence };
  }
  // El cliente crea un encargo que vence en una hora. ZeroAddress desactiva hooks.
  async create(description) {
    const now = (await this.rpc.getBlock("latest")).timestamp;
    const { r, evidence } = await this.tx(
      "Crear encargo",
      this.acp.createJob(
        await this.provider.getAddress(),
        await this.evaluator.getAddress(),
        now + 3600,
        description,
        ZeroAddress,
      ),
    );
    // Obtiene el ID del evento de este recibo, evitando inferirlo desde otro pedido.
    const event = r.logs
      .map((l) => {
        try {
          return this.acp.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e) => e?.name === "JobCreated");
    if (!event) throw Error("No apareció JobCreated.");
    return { id: event.args.jobId.toString(), evidence };
  }
  // Convierte el enum Solidity a número: 0 abierto, 1 financiado, 2 entregado,
  // 3 completado, 4 rechazado y 5 vencido.
  async state(id) {
    return Number((await this.acp.getJob(id)).status);
  }
  // Solo financia encargos abiertos: proveedor fija el precio, cliente autoriza
  // al contrato a mover tokens y luego los deposita en garantía.
  async fund(id) {
    const j = await this.acp.getJob(id);
    if (j.status !== 0n) return [];
    const out = [];
    if (j.budget !== BUDGET)
      out.push(
        (
          await this.tx(
            "Fijar 10 CAMPUS",
            this.acp.connect(this.provider).setBudget(id, BUDGET, "0x"),
          )
        ).evidence,
      );
    // La autorización ERC-20 permite gastar un monto; no es la aprobación del trabajo.
    if (
      (await this.token.allowance(await this.client.getAddress(), this.address)) <
      BUDGET
    )
      out.push(
        (await this.tx("Autorizar 10 CAMPUS", this.token.approve(this.address, BUDGET)))
          .evidence,
      );
    out.push((await this.tx("Financiar", this.acp.fund(id, "0x"))).evidence);
    return out;
  }
  // Registra el hash como proveedor solo cuando el encargo está financiado.
  async submit(id, hash, uri) {
    if ((await this.state(id)) !== 1) return null;
    return (
      await this.tx(
        "Entregar hash",
        // optParams ya existe en el contrato: no requiere cambiar ni desplegar Solidity.
        this.acp
          .connect(this.provider)
          .submit(id, hash, uri ? hexlify(toUtf8Bytes(uri)) : "0x"),
      )
    ).evidence;
  }
  // El evaluador llama complete: el contrato cambia el estado y libera el pago.
  async approve(id, reasonHash) {
    return (
      await this.tx(
        "Aprobar y pagar",
        this.acp.connect(this.evaluator).complete(id, reasonHash, "0x"),
      )
    ).evidence;
  }
  // Si ya es terminal, no repite nada. Antes del depósito rechaza el cliente;
  // después, el evaluador. Si venció con fondos, usa el reclamo de devolución.
  async reject(id, reasonHash) {
    const state = await this.state(id);
    if (![0, 1, 2].includes(state)) return null;
    const j = await this.acp.getJob(id),
      now = (await this.rpc.getBlock("latest")).timestamp;
    if (state !== 0 && BigInt(now) >= j.expiredAt)
      return (await this.tx("Reclamar vencimiento", this.acp.claimRefund(id))).evidence;
    return (
      await this.tx(
        "Rechazar y devolver",
        this.acp
          .connect(state === 0 ? this.client : this.evaluator)
          .reject(id, reasonHash, "0x"),
      )
    ).evidence;
  }
  // Consulta saldos del token y los muestra en CAMPUS con sus 18 decimales.
  async balances() {
    return Object.fromEntries(
      await Promise.all(
        [
          ["client", await this.client.getAddress()],
          ["escrow", this.address],
          ["provider", await this.provider.getAddress()],
        ].map(async ([k, a]) => [k, formatEther(await this.token.balanceOf(a))]),
      ),
    );
  }
  // Libera recursos del proveedor RPC; no apaga un nodo externo.
  close() {
    this.rpc.destroy();
  }
}
