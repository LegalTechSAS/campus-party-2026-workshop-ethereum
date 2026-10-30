/** Firmante local: conserva la llave en memoria y envía solo la transacción firmada. */
import { NonceManager, Wallet, resolveProperties } from "ethers";

export class SepoliaSigner extends NonceManager {
  // NonceManager evita reutilizar un nonce al enviar varias transacciones consecutivas.
  constructor(key, provider, config) {
    super(new Wallet(key, provider));
    this.config = config;
  }

  // Comprueba la red y limita la comisión antes de firmar cualquier operación.
  // La misma protección cubre despliegues y llamadas a los contratos.
  async sendTransaction(transaction) {
    if ((await this.provider.getNetwork()).chainId !== 11155111n)
      throw Error("Se requiere Sepolia 11155111. No se firma en otra red.");
    const request = await resolveProperties(transaction);
    const fees = await this.provider.getFeeData();
    const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice;
    if (maxFeePerGas === null || maxFeePerGas > this.config.maxFeePerGas)
      throw Error(
        "La comisión de gas supera SEPOLIA_MAX_FEE_GWEI; no se envió la transacción.",
      );
    const gasLimit =
      request.gasLimit ?? ((await this.estimateGas(request)) * 120n) / 100n;
    if (gasLimit * maxFeePerGas > this.config.maxTxCost)
      throw Error(
        "El costo máximo estimado supera SEPOLIA_MAX_TX_COST_ETH; no se envió la transacción.",
      );
    const maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? 0n;
    return super.sendTransaction({
      ...request,
      gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas:
        maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : maxPriorityFeePerGas,
    });
  }
}
