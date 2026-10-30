/** Prueba el transporte IPFS con HTTP simulado; no publica archivos reales. */
import test from "node:test";
import assert from "node:assert/strict";
import { IpfsPublisher } from "../src/infrastructure/storage/ipfs-publisher.mjs";
import { modelEnvironment } from "../src/infrastructure/ai/model.mjs";
const cid = "b" + "a".repeat(58);

// Verifica red pública, contenido exacto y que el secreto no vaya en el archivo.
test("sube solo el resumen y conserva el CID público", async () => {
  const publisher = new IpfsPublisher("secreto", async (url, options) => {
    assert.equal(url, "https://uploads.pinata.cloud/v3/files");
    assert.equal(options.headers.Authorization, "Bearer secreto");
    assert.equal(options.body.get("network"), "public");
    assert.equal(await options.body.get("file").text(), "Resumen español.");
    assert.deepEqual([...options.body.keys()], ["network", "file"]);
    return {
      ok: true,
      async json() {
        return { data: { cid } };
      },
    };
  });
  assert.deepEqual(await publisher.publish("Resumen español."), {
    cid,
    uri: `ipfs://${cid}`,
    url: `https://ipfs.io/ipfs/${cid}`,
  });
});

// Un error del proveedor o una respuesta inválida no produce una URI inventada.
test("rechaza credenciales ausentes, HTTP fallido y CID inválido", async () => {
  assert.throws(() => new IpfsPublisher(""), /PINATA_JWT/u);
  await assert.rejects(
    new IpfsPublisher("s", async () => ({ ok: false, status: 401 })).publish("Texto"),
    /HTTP 401/u,
  );
  await assert.rejects(
    new IpfsPublisher("s", async () => ({
      ok: true,
      async json() {
        return { data: { cid: "../invalido" } };
      },
    })).publish("Texto"),
    /CID válido/u,
  );
});

// La credencial de almacenamiento tampoco se comparte con el proceso de IA.
test("la IA no hereda el JWT de Pinata", () => {
  assert.deepEqual(modelEnvironment({ PINATA_JWT: "secreto", PATH: "/bin" }), {
    PATH: "/bin",
  });
});

// La API clásica usa dos cabeceras, otro endpoint y un formato de respuesta distinto.
test("publica con API Key y Secret sin enviar un Bearer", async () => {
  const publisher = new IpfsPublisher(
    { jwt: "ignorado", apiKey: "key", apiSecret: "secret" },
    async (url, options) => {
      assert.equal(url, "https://api.pinata.cloud/pinning/pinFileToIPFS");
      assert.deepEqual(options.headers, {
        pinata_api_key: "key",
        pinata_secret_api_key: "secret",
      });
      assert.equal(options.body.has("network"), false);
      assert.equal(await options.body.get("file").text(), "Resumen.");
      assert.equal(
        JSON.parse(options.body.get("pinataOptions")).wrapWithDirectory,
        false,
      );
      return {
        ok: true,
        async json() {
          return { IpfsHash: cid };
        },
      };
    },
  );
  assert.equal((await publisher.publish("Resumen.")).uri, `ipfs://${cid}`);
  assert.throws(() => new IpfsPublisher({ apiKey: "key" }), /PINATA_API_SECRET/u);
  assert.throws(
    () => new IpfsPublisher({ apiSecret: "secret", jwt: "no-cambiar-modo" }),
    /PINATA_API_KEY/u,
  );
  assert.deepEqual(
    modelEnvironment({
      PINATA_API_KEY: "key",
      PINATA_API_SECRET: "secret",
      PATH: "/bin",
    }),
    { PATH: "/bin" },
  );
});
