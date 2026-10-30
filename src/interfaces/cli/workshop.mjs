/**
 * Ruta supervisada, conservada como herramienta didáctica del contrato.
 * Cada comando ejecuta un paso manual. La práctica autónoma usa agent.mjs
 * y guarda sus datos por separado; no mezclar ambas rutas para un mismo pedido.
 */

import fs from "node:fs";
import assert from "node:assert/strict";
import {
  JsonRpcProvider,
  Contract,
  ContractFactory,
  Interface,
  ZeroAddress,
  parseEther,
  formatEther,
  keccak256,
  toUtf8Bytes,
} from "ethers";
// El taller solo firma con cuentas desbloqueadas de la red LOCAL.
const rpc = new JsonRpcProvider("http://127.0.0.1:8545");
if ((await rpc.getNetwork()).chainId !== 31337n)
  throw Error("Se requiere la red local 31337.");
// La cuarta cuenta representa a un tercero sin permisos durante las pruebas.
const [client, provider, evaluator, outsider] = await Promise.all(
  [0, 1, 2, 3].map((i) => rpc.getSigner(i)),
);
// Carga la interfaz y el programa compilados de un contrato.
const artifact = (n) => JSON.parse(fs.readFileSync("build/" + n + ".json", "utf8"));
// Traduce los valores numéricos del enum a nombres legibles.
const states = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"];
// Esta sesión manual está separada del historial del agente autónomo.
const store = "data/session.json";
// Envía una operación, espera confirmación e imprime hash, bloque y gas reales.
async function tx(label, p) {
  const t = await p;
  const r = await t.wait();
  console.log(
    `${label}\n  hash: ${r.hash}\n  bloque: ${r.blockNumber}\n  gas usado: ${r.gasUsed}`,
  );
  return r;
}
// Despliega un contrato desde la cuenta del cliente y espera su confirmación.
async function deploy(name, args) {
  const a = artifact(name);
  const c = await new ContractFactory(a.abi, a.bytecode, client).deploy(...args);
  await c.waitForDeployment();
  console.log(name + ": " + (await c.getAddress()));
  return c;
}
// Prepara token, implementación y proxy, y guarda sus direcciones para otros comandos.
async function setup() {
  fs.mkdirSync("data", { recursive: true });
  const token = await deploy("WorkshopToken", [await client.getAddress()]);
  const impl = await deploy("AgenticCommerce", []);
  const init = new Interface(artifact("AgenticCommerce").abi).encodeFunctionData(
    "initialize",
    [await token.getAddress(), await evaluator.getAddress()],
  );
  const proxy = await deploy("ERC1967Proxy", [await impl.getAddress(), init]);
  const acp = new Contract(
    await proxy.getAddress(),
    artifact("AgenticCommerce").abi,
    client,
  );
  fs.writeFileSync(
    store,
    JSON.stringify(
      {
        token: await token.getAddress(),
        acp: await acp.getAddress(),
        implementation: await impl.getAddress(),
        jobId: null,
      },
      null,
      2,
    ),
  );
  console.log("Cliente: " + (await client.getAddress()));
  console.log("Proveedor: " + (await provider.getAddress()));
  console.log("Evaluador: " + (await evaluator.getAddress()));
  return { token, acp };
}
// Recupera la sesión manual y crea objetos ethers para interactuar con ella.
function load() {
  if (!fs.existsSync(store)) throw Error("Ejecutá npm run setup primero.");
  const s = JSON.parse(fs.readFileSync(store, "utf8"));
  return {
    s,
    token: new Contract(s.token, artifact("WorkshopToken").abi, client),
    acp: new Contract(s.acp, artifact("AgenticCommerce").abi, client),
  };
}
// Crea un nuevo encargo, fija su presupuesto de 10 CAMPUS y deposita los tokens.
async function fund() {
  const { s, token, acp } = load();
  const now = (await rpc.getBlock("latest")).timestamp;
  await tx(
    "Crear encargo",
    acp.createJob(
      await provider.getAddress(),
      await evaluator.getAddress(),
      now + 3600,
      "Resumen en español, máximo 100 palabras, fiel al texto de entrada.txt",
      ZeroAddress,
    ),
  );
  const id = await acp.jobCounter();
  s.jobId = id.toString();
  fs.writeFileSync(store, JSON.stringify(s, null, 2));
  const amount = parseEther("10");
  await tx(
    "Proveedor fija presupuesto: 10 CAMPUS",
    acp.connect(provider).setBudget(id, amount, "0x"),
  );
  await tx("Cliente autoriza al contrato por 10 CAMPUS", token.approve(s.acp, amount));
  await tx("Cliente financia la garantía", acp.fund(id, "0x"));
  return id;
}
// Comprueba longitud y obtiene la huella del archivo; no verifica idioma ni fidelidad.
function summary() {
  if (!fs.existsSync("resumen.txt"))
    throw Error(
      "Falta resumen.txt. Pedile a Claude Code que lo genere desde entrada.txt.",
    );
  const text = fs.readFileSync("resumen.txt", "utf8").trim();
  const count = text ? text.split(/\s+/u).length : 0;
  if (!count || count > 100)
    throw Error(`Resumen inválido: ${count} palabras. Se requieren entre 1 y 100.`);
  console.log("Palabras: " + count);
  return { text, hash: keccak256(toUtf8Bytes(text)) };
}
// Lee el estado actual del encargo y los saldos reales en la red local activa.
async function status() {
  const { s, token, acp } = load();
  console.log("Red local: 31337");
  if (s.jobId) {
    const j = await acp.getJob(s.jobId);
    console.log(
      `Encargo ${s.jobId}: ${states[Number(j.status)]}; presupuesto ${formatEther(j.budget)} CAMPUS`,
    );
  }
  for (const [n, a] of [
    ["Cliente", await client.getAddress()],
    ["Garantía", s.acp],
    ["Proveedor", await provider.getAddress()],
  ])
    console.log(n + ": " + formatEther(await token.balanceOf(a)) + " CAMPUS");
}
// Entrega la huella y la guarda localmente para detectar cambios antes de aprobar.
async function submit() {
  const { s, acp } = load();
  const { hash } = summary();
  await tx(
    "Proveedor entrega hash del resumen",
    acp.connect(provider).submit(s.jobId, hash, "0x"),
  );
  fs.writeFileSync(
    "data/submission.json",
    JSON.stringify({ jobId: s.jobId, hash }, null, 2),
  );
  console.log(
    "El contenido queda en resumen.txt; solo su hash queda en el evento on-chain.",
  );
}
// Tras la revisión manual, verifica que el archivo no cambió y ejecuta el pago.
async function approve() {
  const { s, acp } = load();
  const { hash } = summary();
  const submitted = JSON.parse(fs.readFileSync("data/submission.json", "utf8"));
  if (submitted.jobId !== s.jobId || submitted.hash !== hash)
    throw Error("El resumen cambió desde la entrega.");
  await tx(
    "Evaluador aprueba y libera el pago",
    acp.connect(evaluator).complete(s.jobId, hash, "0x"),
  );
}
// Prueba estados y permisos con entregas fijas, sin llamar a un modelo de IA.
async function test() {
  await setup();
  const id = await fund();
  let { token, acp, s } = load();
  assert.equal((await acp.getJob(id)).status, 1n);
  assert.equal(await token.balanceOf(s.acp), parseEther("10"));
  // Comprueba que una cuenta ajena no puede ejecutar una acción reservada a otro rol.
  await assert.rejects(
    acp.connect(outsider).complete(id, keccak256(toUtf8Bytes("x")), "0x"),
  );
  await assert.rejects(
    acp.connect(outsider).submit(id, keccak256(toUtf8Bytes("x")), "0x"),
  );
  const h = keccak256(toUtf8Bytes("Entrega de prueba de contrato, no generada por IA"));
  await tx("Prueba de entrega", acp.connect(provider).submit(id, h, "0x"));
  await assert.rejects(acp.connect(outsider).complete(id, h, "0x"));
  await tx("Prueba de aprobación", acp.connect(evaluator).complete(id, h, "0x"));
  assert.equal((await acp.getJob(id)).status, 3n);
  assert.equal(await token.balanceOf(await provider.getAddress()), parseEther("10"));
  assert.equal(await token.balanceOf(s.acp), 0n);
  // Un segundo encargo verifica que el rechazo libera la garantía al cliente.
  const rejected = await fund();
  await tx("Prueba de rechazo", acp.connect(evaluator).reject(rejected, h, "0x"));
  assert.equal((await acp.getJob(rejected)).status, 4n);
  assert.equal(await token.balanceOf(s.acp), 0n);
  // Avanza el reloj de Hardhat para comprobar la devolución tras vencer el plazo.
  const expired = await fund();
  await rpc.send("evm_increaseTime", [3700]);
  await rpc.send("evm_mine", []);
  await tx("Prueba de vencimiento", acp.claimRefund(expired));
  assert.equal((await acp.getJob(expired)).status, 5n);
  assert.equal(await token.balanceOf(s.acp), 0n);
  console.log(
    "PASS: pago, rechazo, vencimiento y control de roles. Estas pruebas no ejecutan IA.",
  );
}
// El argumento que agrega cada script de npm selecciona el paso manual a ejecutar.
const action = process.argv[2];
try {
  if (action === "setup") await setup();
  else if (action === "fund") await fund();
  else if (action === "status") await status();
  else if (action === "check") summary();
  else if (action === "submit") await submit();
  else if (action === "approve") await approve();
  else if (action === "reject") {
    const { s, acp } = load();
    await tx(
      "Evaluador rechaza",
      acp
        .connect(evaluator)
        .reject(s.jobId, keccak256(toUtf8Bytes("No cumple los criterios")), "0x"),
    );
  } else if (action === "test") await test();
  else throw Error("Comando desconocido.");
  // Cierra la conexión incluso si un comando falla.
} finally {
  rpc.destroy();
}
