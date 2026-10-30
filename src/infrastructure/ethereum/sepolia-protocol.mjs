/** Adaptador para Sepolia pública: firma localmente con tres cuentas configuradas. */
import { formatEther, parseEther } from "ethers";
import { Protocol } from "./protocol.mjs";
import { SepoliaSigner } from "./sepolia-signer.mjs";

export class SepoliaProtocol extends Protocol {
  // simulation solo se usa en la prueba controlada; no se configura desde .env.
  constructor(root, config) {
    super(root, config.rpcURL, {
      chainId: 11155111n,
      storageNamespace: "sepolia",
      stateFile: "deployment.json",
      explorer: config.simulation ? undefined : "https://sepolia.etherscan.io",
      confirmations: config.confirmations,
      simulation: config.simulation,
    });
    this.config = config;
  }

  // La llave se carga en memoria: el proveedor RPC nunca recibe el secreto.
  async loadSigners() {
    return this.config.keys.map((key) => new SepoliaSigner(key, this.rpc, this.config));
  }

  // Diagnóstico de solo lectura: direcciones y ETH de prueba disponibles para gas.
  async doctor() {
    if ((await this.rpc.getNetwork()).chainId !== 11155111n)
      throw Error("El RPC no corresponde a Sepolia 11155111.");
    const signers = await this.loadSigners();
    return Promise.all(
      signers.map(async (signer, index) => {
        const address = await signer.getAddress();
        return {
          role: ["cliente", "proveedor", "evaluador"][index],
          address,
          gasETH: formatEther(await this.rpc.getBalance(address)),
          explorer: `https://sepolia.etherscan.io/address/${address}`,
        };
      }),
    );
  }

  // Top-up opcional y explícito: el cliente aporta hasta 0,002 ETH de prueba por rol.
  // No es el precio del servicio: permite que proveedor y evaluador paguen su gas.
  async fundRoles() {
    if ((await this.rpc.getNetwork()).chainId !== 11155111n)
      throw Error("Se requiere Sepolia.");
    const [client, ...roles] = await this.loadSigners();
    const target = parseEther("0.002");
    for (const signer of roles) {
      const address = await signer.getAddress(),
        balance = await this.rpc.getBalance(address);
      if (balance < target)
        await this.tx(
          "Asignar ETH de prueba para gas",
          client.sendTransaction({ to: address, value: target - balance }),
        );
    }
  }
}
