# Ethereum y agentes de IA · Campus Party

Proyecto: `workshop-ethereum-agentes-campus-party`.
Workshop de 60 minutos: conceptos y pagos (0–25), práctica (25–55), preguntas (55–60).

## Qué vamos a ejecutar

Un agente lee `entrada.txt`, crea un encargo y deposita **10 CAMPUS en Sepolia**. Consulta a Claude Code o Cursor para producir un resumen en español de hasta 100 palabras y lo evalúa mediante otra consulta. Puede corregirlo una vez. Registra la huella del resultado final y resuelve automáticamente: paga al proveedor o rechaza y devuelve los fondos.

**Sepolia es una blockchain pública de prueba.** Contratos, token y transacciones son reales y verificables allí; CAMPUS es un token didáctico, no una moneda de valor prometido. El gas se paga con ETH de Sepolia. No se opera en Ethereum mainnet.

El programa y las consultas de IA siguen ejecutándose fuera de la blockchain. El texto se guarda en tu equipo y se envía al proveedor de IA elegido; el contrato recibe una descripción del pedido y huellas. Usá el texto de ejemplo sin datos sensibles.

## Preparación antes del evento

- Node.js 22.13+ o 24+.
- VS Code con Claude Code o Cursor para editar.
- La CLI del proveedor elegida instalada y autenticada: la extensión del editor no la sustituye.
- Tres cuentas distintas de prueba con ETH de Sepolia: cliente, proveedor y evaluador.
- Conexión a internet y un RPC HTTPS de Sepolia; se incluye uno público como valor inicial.

Extraé el ZIP y abrí el proyecto desde VS Code: **Archivo → Abrir carpeta… → workshop-ethereum-agentes-campus-party**. Después, elegí **Terminal → Nueva terminal** y ejecutá:

```sh
npm ci
npm run compile
```

En Cursor podés abrirla con Archivo > Abrir carpeta. El repositorio todavía no está publicado en GitHub; no hay una URL de clonación definida.

## 1. Configurar las cuentas personalmente

```sh
cp .env.example .env
```

Si no ves `.env.example`, usá la copia visible **`ENV.example`**, incluida en la raíz del proyecto: desde el explorador de VS Code, duplicala y renombrá la copia a `.env`. Ambas plantillas contienen los mismos campos vacíos. En Finder, los nombres que empiezan con punto pueden estar ocultos.

Abrí `.env` en tu editor y completá:

```dotenv
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
CLIENT_PRIVATE_KEY=
PROVIDER_PRIVATE_KEY=
EVALUATOR_PRIVATE_KEY=
SEPOLIA_MAX_FEE_GWEI=20
SEPOLIA_MAX_TX_COST_ETH=0.05
```

Cada llave privada puede llevar `0x` seguido de 64 caracteres hexadecimales, o escribirse como 64 caracteres hexadecimales sin prefijo. Usá cuentas exclusivas de prueba. No pegues las llaves en la PPT, el chat, una captura o un archivo versionado. `.env` está excluido de Git y del paquete descargable. `.env.example` solo contiene campos vacíos y comentarios.

Las llaves se leen localmente y firman en memoria. El RPC recibe transacciones firmadas, no las llaves. Las consultas de IA se ejecutan desde una carpeta temporal vacía y sin heredar las llaves o el endpoint RPC como variables. Esto reduce exposición accidental; no convierte las CLIs en una caja aislada del sistema operativo. Este ejemplo usa un archivo local de configuración por simplicidad docente; no es un servicio de custodia o gestión de secretos para producción.

Consultá red, direcciones públicas y ETH de prueba disponible:

```sh
npm run sepolia:doctor
```

Este comando solo lee: no despliega ni transfiere. Debe indicar **Sepolia, chainId 11155111**. Cada rol paga gas por las acciones que firma. El cliente además despliega CAMPUS y los contratos y deposita los tokens del pedido.

Si proveedor o evaluador no tienen ETH de prueba, podés usar un faucet de Sepolia o ejecutar explícitamente:

```sh
npm run sepolia:fund-roles
```

Este último comando transfiere desde el cliente solo lo necesario para llevar a cada uno de los otros dos roles a **0,002 ETH de Sepolia**. Omite roles que ya tienen ese saldo. No es el precio del servicio ni asegura gas suficiente para cualquier cantidad de pedidos. Si las tres cuentas ya tienen fondos, no hace falta ejecutarlo.

## 2. Iniciar sesión en el proveedor de IA

Con Claude Code, la opción predeterminada:

```sh
claude --version
claude auth login
claude auth status --json
```

Con Cursor CLI:

```sh
agent --version
agent login
```

El ejecutable de Cursor CLI se llama `agent`. La cuenta y el plan deben permitir usar la CLI; pueden aplicar cuotas o cargos. El programa usa Claude sin herramientas ni MCP y Cursor en modo `ask` de solo lectura. Los movimientos económicos los ejecuta el adaptador Ethereum del programa, dentro de los límites configurados.

Fuentes oficiales: [Claude Code](https://code.claude.com/docs/en/setup) · [Cursor CLI](https://cursor.com/docs/cli/installation).

## 3. Desplegar CAMPUS y el contrato en Sepolia

```sh
npm run sepolia:deploy
```

Publica el token **Campus (CAMPUS)** con 1000 unidades iniciales para el cliente, la implementación de comercio y el proxy ERC-1967. Espera confirmación e imprime hashes y enlaces a **Sepolia Etherscan**. Las direcciones, cuentas y recibos quedan en:

```text
data/sepolia/deployment.json
```

Si repetís el comando con las mismas cuentas, reutiliza el despliegue guardado. Guarda cada contrato confirmado antes de avanzar al siguiente para continuar una preparación interrumpida. Si cambiaste las cuentas, se detiene: no reemplaza silenciosamente el despliegue.

La información del archivo es importante para seguir usando tus contratos. No la confundas con un secreto: contiene direcciones y recibos públicos, pero cada participante debe conservar su propia copia. No borres el historial para eludir límites o simular que un pedido es nuevo.

## 4. Ejecutar el agente autónomo

Con Claude Code:

```sh
npm run agent
```

Con Cursor:

```sh
npm run agent -- --engine cursor
```

Elegí una de las dos opciones. Cada ejecución sin `--id` crea un pedido nuevo: no vuelvas a ejecutar solo para mirar el estado. Para observar el último resultado, usá `inspect`.

El agente reutiliza los contratos o los despliega si todavía faltan. Para el taller conviene desplegarlos antes, con el paso anterior. En Sepolia **no ejecutás `npm run chain`**: te conectás a la red pública.

El ciclo hace lo siguiente sin confirmación manual por paso:

1. Comprueba acceso al modelo y conexión a Sepolia.
2. Reserva presupuesto, crea el encargo y deposita 10 CAMPUS.
3. Genera un resumen y solicita una evaluación separada.
4. Si hace falta, corrige una vez y vuelve a evaluar.
5. Entrega la huella final y completa/paga o rechaza/devuelve.

El contrato no entiende español ni fidelidad. La IA estima esas propiedades y puede equivocarse. Dos consultas al mismo proveedor no equivalen a dos árbitros independientes. El código impone el límite de palabras y exige confianza declarada mínima de 0,9, lo que tampoco garantiza calidad.

## 5. Revisar resultado, saldos y explorador

```sh
npm run inspect
```

Lee el último registro guardado, no saldos nuevos en vivo. En la terminal aparecen estado, saldos al resolver, hashes y enlaces. Los archivos de cada pedido quedan en:

```text
data/sepolia/runs/ID/input.txt
data/sepolia/runs/ID/resumen.txt
data/sepolia/runs/ID/evaluation.json
data/sepolia/runs/ID/journal.json
```

En una ejecución aprobada, el proveedor cobra 10 CAMPUS y la garantía de ese encargo se libera. En un rechazo, el cliente recupera los 10 CAMPUS depositados. Los saldos totales dependen de los pedidos anteriores.

Abrí los enlaces de las transacciones en `https://sepolia.etherscan.io`. Verificá estado, direcciones, gas y eventos del contrato. No busques esas transacciones en Etherscan mainnet.

## 6. Modo continuo y ejecución 24/7

`npm run agent` resuelve un pedido y termina. Para esperar pedidos:

```sh
npm run worker
```

Con Cursor:

```sh
npm run worker -- --engine cursor
```

En otra terminal:

```sh
npm run enqueue -- entrada.txt
```

El trabajador observa `inbox/`, procesa de uno en uno y archiva los archivos en `processed/`. Ctrl+C solicita terminar tras el pedido en curso. La computadora, internet y la sesión de IA deben permanecer disponibles. **Este proyecto no despliega por sí mismo un servicio 24/7.**

Sepolia conserva los contratos y transacciones aunque apagues el agente. Eso no significa que la IA siga trabajando ni que un contrato se ejecute solo por pasar el tiempo. Los vencimientos requieren una transacción para reclamar la devolución.

## Límites, gas y recuperación

- Ruta principal: solo Sepolia **11155111**, con firma local y RPC HTTPS.
- Precio: 10 CAMPUS por pedido, hasta 100 CAMPUS acumulados reservados.
- Máximo 2 intentos, 100 palabras y 20.000 caracteres de entrada.
- Hasta 4 consultas de IA por pedido; cuotas según la cuenta elegida.
- Antes de firmar, el adaptador limita el gas según `.env`. Si supera el techo, se detiene sin enviar esa transacción.
- Los límites de gas se expresan en ETH de prueba y no se descuentan del precio en CAMPUS.
- Un solo proceso por carpeta. Las reservas e historiales de Sepolia están separados de los de la red local.
- Si el modelo falla después de financiar, intenta rechazar y devolver automáticamente. Eso también requiere gas del evaluador.
- Si falla la red o no hay gas para devolver, puede quedar `needs-recovery`. No se afirma que los fondos volvieron sin comprobarlo.

Para retomar un pedido pendiente, conservá sus cuentas, contratos, ID y entrada originales:

```sh
npm run agent -- --id ID --input ARCHIVO
```

No borres `data/sepolia/` ni reejecutes con otro ID para tratar un error como si no hubiera existido. Un archivo local y una transacción minada no forman una transacción atómica: un corte justo después de enviar o confirmar puede requerir inspección manual de los recibos y del contrato. No es una infraestructura de pagos lista para producción.

## Código comentado y Clean Architecture

Todos los archivos de código del proyecto incluyen comentarios explicativos en español. Las capas son:

- `src/domain/`: política, validación y estados, sin archivos, Node ni ethers.
- `src/application/`: caso de uso y puertos recibidos por parámetros.
- `src/infrastructure/`: IA, Ethereum, configuración, huellas y persistencia.
- `src/interfaces/cli/`: opciones, cola y salida de terminal.
- `src/main/`: composición de los adaptadores concretos.
- `contracts/`: CAMPUS y contrato de comercio con comentarios didácticos.

Leé primero `src/domain/policy.mjs`, después `src/application/execute-job.mjs`, los adaptadores `model.mjs`/`sepolia-protocol.mjs` y la CLI. `ARCHITECTURE.md` explica la separación. JSON no admite comentarios: esta guía explica `package.json`, lockfile y configuración de formato. Las dependencias de terceros conservan sus propias fuentes y documentación.

## Pruebas y formato

```sh
npm run format
npm run format:check
npm run lint
npm run verify
```

`verify` comprueba formato, lint, capas, pruebas del agente e integraciones. `npm run test:sepolia` prueba el adaptador con llaves efímeras y una **EVM privada que usa chainId 11155111**. Comprueba firmas, gas por rol, despliegue, pago, devolución y límites. **Ese entorno simulado no es Sepolia pública.** Las respuestas de IA de las pruebas también son simuladas.

La validación pública requiere completar `.env`, ejecutar `sepolia:doctor`, desplegar y comprobar los enlaces de recibos. No se inventan direcciones, hashes públicos ni resultados de una cuenta autenticada.

Para práctica sin fondos públicos se conserva una ruta opcional:

```sh
npm run agent:local
npm run inspect -- --local
```

Usa Hardhat local 31337. Los comandos manuales antiguos (`setup`, `fund`, `submit`, `approve`, `reject`, `status`) son herramientas didácticas locales separadas, no el recorrido de Sepolia de esta guía.

## Estándares y fuentes

La demo usa la implementación de referencia de ERC-8183, no se afirma conformidad completa con todas las interfaces del borrador. **ERC-8004 integra los registros de identidad y reputación de Sepolia; el registro de validación no está implementado.** Las tres cuentas del taller pertenecen al mismo operador; no constituyen tres organizaciones independientes.

[Redes de Ethereum](https://ethereum.org/developers/docs/networks/) · [Sepolia](https://github.com/eth-clients/sepolia) · [Wallets en ethers](https://docs.ethers.org/v6/api/wallet/) · [ERC-8183](https://eips.ethereum.org/EIPS/eip-8183).

## Leer el resumen públicamente con IPFS

La publicación es opcional y se aplica a nuevos encargos. Creá una cuenta en Pinata
y una credencial JWT con permiso de subir archivos. En tu `.env` agregá:

```dotenv
PUBLISH_TO_IPFS=true
PINATA_JWT=
```

Completá el JWT personalmente y ejecutá `npm run agent`. La integración usa la
[API oficial de Pinata](https://docs.pinata.cloud/api-reference/endpoint/upload-a-file).
El agente publica solo el resumen final como `resumen.txt`, incluso si es rechazado;
no publica el original, la evaluación ni las claves. Muestra `Resumen público: ...`.
`npm run inspect` y `journal.json` conservan `publication.cid`, `uri` y `url`.

En Etherscan abrí la transacción **Entregar hash** → **Input Data** → **Decode Input Data**.
El argumento `optParams` contiene los bytes UTF-8 de `ipfs://CID`. Convertí esos bytes
hexadecimales a texto o usá el enlace que muestra el programa. El argumento `deliverable`
y el evento `JobSubmitted` contienen el hash Keccak-256 del texto UTF-8 exacto, no el CID.
El contrato no almacena la URI en `jobs` ni la emite en el evento: queda en el calldata
público de esa transacción. Esto funciona con el contrato ya desplegado.

El texto vive en IPFS y depende de que permanezca alojado (pineado). Sepolia conserva
la referencia, no el archivo. Los gateways pueden tardar en mostrarlo. Si falla la subida,
el encargo no se paga y se intenta devolver el depósito, como ante otros fallos del flujo.
Los encargos cerrados antes de activar esta opción conservan únicamente su hash;
este cambio no publica retrospectivamente sus respuestas.

### Alternativa: API Key y API Secret

También podés autenticar con el par de credenciales de la API clásica de Pinata:

```dotenv
PUBLISH_TO_IPFS=true
PINATA_API_KEY=
PINATA_API_SECRET=
```

Completá ambos campos en `.env`. La API Key sola no alcanza. El par tiene prioridad
sobre `PINATA_JWT` y usa `pinFileToIPFS`; requiere permiso para esa operación.
No hace falta instalar el SDK clásico ni cambiar el contrato.

## Publicar este proyecto en GitHub

El repositorio debe incluir el código, los contratos, las pruebas, la documentación,
`package.json`, `package-lock.json` y las plantillas vacías `.env.example` y
`ENV.example`. Cada participante instala las dependencias con `npm ci` y crea su
propio `.env`; las cuentas y el despliegue del docente no se distribuyen.

El `.gitignore` excluye credenciales, dependencias, compilación, registros de
encargos y directorios de trabajo. Conservá el original de tu `.env` localmente.
Antes de publicar, revisá `git status --short` y `git diff --cached`: no debe
aparecer `.env`, `data/`, `node_modules/`, `build/` ni `artifacts/`.

El `.gitignore` no retira secretos que ya se hayan agregado a un historial Git.
Las plantillas deben conservar los campos de claves y credenciales vacíos.

## Identidad y reputación ERC-8004 en Sepolia

Registrá una identidad pública una sola vez con la wallet del proveedor:

```bash
npm run agent:register
npm run agent
npm run reputation
```

`agent:register` firma una transacción y consume ETH de Sepolia. Guarda el ID en
`data/sepolia/agent-identity.json`; conservá esta carpeta para reutilizar la identidad.
El registro incorpora una ficha JSON pública con el nombre CAMPUS y su descripción.
El comando `reputation` solo lee los registros oficiales y muestra el ID, cantidad de
feedbacks, promedio de 0–100 y enlaces de Etherscan. No requiere volver a generar un resumen.

Los nuevos encargos evaluados y resueltos registran 100 si fueron completados y 0
si fueron rechazados por calidad. No se califica un fallo de IPFS, conexión o modelo.
Firma la wallet del evaluador, distinta de la del proveedor. Ambas son controladas
por el docente: esto demuestra el mecanismo, no una reputación independiente.
El promedio se filtra por ese evaluador y las etiquetas `campus-summary`/`quality`;
no se presenta como una puntuación global del ecosistema.

El feedback incluye la referencia al contrato y encargo y una huella del resultado
y la evaluación. No publica el texto de la evaluación. No se implementa el registro
de validación. Si falla la reputación, `inspect` muestra `reputationError` sin alterar
el pago o devolución. El hash de una transacción de feedback enviada se conserva para
no reenviarla al recuperar el proceso. Ejecutar el mismo ID reintenta feedback pendiente;
no vuelve a pagar. No se califican automáticamente encargos históricos.

Direcciones y ABI consultados en las [fuentes oficiales ERC-8004](https://github.com/erc-8004/erc-8004-contracts):
Identity `0x8004A818BFB912233c491871b3d84c89A494BD9e` y Reputation
`0x8004B663056A597Dffe9eCcC1965A193B7388713`.

## Demo local opcional: rechazo y revert

```bash
npm run demo:reject-revert:local
```

Un solo comando compila, inicia una blockchain Hardhat temporal, despliega CAMPUS
y comercio, deposita 10 CAMPUS y muestra dos situaciones con explicaciones y saldos:

1. **Revert `WrongStatus`**: intentar pagar antes de entregar. Se usa `eth_call`;
   ejecuta las reglas reales de la EVM sin emitir una transacción fallida ni consumir gas.
2. **Reject**: el evaluador rechaza el encargo y una transacción local devuelve los
   10 CAMPUS al cliente. Verifica cliente 1000, contrato 0 y proveedor 0.
3. **Revert `WrongStatus`**: intentar entregar después del rechazo, también con `eth_call`.

No consulta IA ni IPFS, no carga `.env`, no firma con tus wallets y no opera en
Sepolia. Se cierra el nodo y se borran los datos temporales al terminar. Esta demo
no genera reputación ERC-8004; muestra únicamente el contrato de comercio.

## Demo real en Sepolia: rechazo y revert minado

Después de configurar `.env` y desplegar con `npm run sepolia:deploy`, ejecutá:

```bash
npm run demo:reject-revert
```

Crea un encargo nuevo y deposita 10 CAMPUS. Intenta pagar antes de entregar:
primero verifica `WrongStatus` con una llamada, luego **envía realmente** la
transacción inválida con gas explícito. Espera su recibo `status: 0` y muestra
el enlace de Etherscan marcado Failed. El gas se consume; los CAMPUS no cambian.
Después el evaluador rechaza el encargo mediante una transacción válida
`status: 1`, y el cliente recupera los 10 CAMPUS. La consola explica los pasos,
los saldos y los dos enlaces. No consulta IA/IPFS ni califica reputación.

Usa el despliegue existente; no despliega silenciosamente contratos nuevos.
Conserva evidencia en `data/sepolia/demo-reject-revert.json` y una copia por demo.
Si se interrumpe, repetí el comando para continuar la demo pendiente. No borres
`data/sepolia/`: podrías perder las referencias del encargo y las transacciones.
Una ejecución completada permite crear otra demo al ejecutar nuevamente.
No corras en paralelo el agente u otra demo; ambos usan `data/agent.lock`.
Si el proceso terminó abruptamente y quedó ese archivo, comprobá que no siga
corriendo antes de retirarlo. Los límites de gas del `.env` siguen activos.
