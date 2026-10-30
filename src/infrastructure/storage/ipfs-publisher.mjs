/** Publica únicamente el resumen final como archivo público de IPFS mediante Pinata. */
export class IpfsPublisher {
  // Inyectar HTTP permite probar el adaptador sin credenciales ni subidas reales.
  constructor(credentials, request = fetch) {
    const config =
      typeof credentials === "string" ? { jwt: credentials } : credentials || {};
    const jwt = config.jwt?.trim(),
      key = config.apiKey?.trim(),
      secret = config.apiSecret?.trim();
    // El par explícito tiene prioridad; una configuración incompleta falla antes de financiar.
    if (key || secret) {
      if (!key || !secret)
        throw Error("Completá PINATA_API_KEY y PINATA_API_SECRET en .env.");
      this.legacy = true;
      this.headers = { pinata_api_key: key, pinata_secret_api_key: secret };
    } else {
      if (!jwt)
        throw Error(
          "Configurá PINATA_JWT o PINATA_API_KEY + PINATA_API_SECRET en .env.",
        );
      this.headers = { Authorization: `Bearer ${jwt}` };
    }
    this.request = request;
  }

  // No envía el historial, la evaluación, la entrada ni las claves de Ethereum.
  async publish(summary) {
    const body = new FormData();
    if (this.legacy)
      body.append(
        "pinataOptions",
        JSON.stringify({ cidVersion: 1, wrapWithDirectory: false }),
      );
    else body.append("network", "public");
    body.append(
      "file",
      new Blob([summary], { type: "text/plain;charset=utf-8" }),
      "resumen.txt",
    );
    const endpoint = this.legacy
      ? "https://api.pinata.cloud/pinning/pinFileToIPFS"
      : "https://uploads.pinata.cloud/v3/files";
    const response = await this.request(endpoint, {
      method: "POST",
      headers: this.headers,
      body,
      signal: AbortSignal.timeout(60000),
    });
    // No muestra cuerpos de error externos que podrían incluir datos privados.
    if (!response.ok)
      throw Error(`No se pudo publicar en IPFS: HTTP ${response.status}.`);
    const result = await response.json();
    const cid = this.legacy ? result.IpfsHash : result.data?.cid;
    if (
      typeof cid !== "string" ||
      !/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,120})$/u.test(cid)
    )
      throw Error("Pinata no devolvió un CID válido.");
    return { cid, uri: `ipfs://${cid}`, url: `https://ipfs.io/ipfs/${cid}` };
  }
}
