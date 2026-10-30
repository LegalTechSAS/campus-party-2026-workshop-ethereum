# Arquitectura del proyecto

El agente se organiza siguiendo la regla de dependencias de Clean Architecture: las reglas del negocio no conocen los detalles de archivos, terminal, modelos de IA ni Ethereum. Es una aplicación pequeña para enseñar un flujo; no necesita un contenedor de inyección ni una clase por cada dato.

## Capas y responsabilidades

```text
scripts/                      Comandos estables que ejecuta npm
src/
  domain/                     Reglas puras: política, validación y estados
  application/                Caso de uso y contratos de sus colaboradores
  infrastructure/
    ai/                       Claude Code, Cursor y Ollama
    ethereum/                 Cuentas, contratos y transacciones; adaptadores local y Sepolia
    persistence/              Historial y presupuesto guardados en archivos
    config/                   Variables de entorno y configuración privada
    crypto/                   Huellas keccak256
  interfaces/cli/             Argumentos, ciclo de proceso, cola y salida de terminal
  main/                       Conexión de los adaptadores con el caso de uso
contracts/                    Token CAMPUS y contratos Solidity
```

- **Dominio:** `policy.mjs` define límites, valida pedidos y calcula reservas sin mutar el dato recibido. `job-status.mjs` explica los estados del contrato. No importan Node ni bibliotecas externas.
- **Aplicación:** `execute-job.mjs` coordina crear, financiar, generar, evaluar, entregar y resolver. Recibe modelo, protocolo, repositorio, calculador de huellas y destino de mensajes por parámetros. `ports.mjs` documenta esas interfaces con JSDoc en español.
- **Infraestructura:** implementa los puertos. Se puede sustituir el repositorio de archivos o el proveedor de IA sin reescribir el dominio. El adaptador Ethereum transforma llamadas en transacciones y devuelve sus recibos. Sepolia usa llaves locales, un administrador de nonces y límites de gas; el adaptador local usa las cuentas desbloqueadas de Hardhat.
- **Interfaz de terminal:** prepara el proceso, interpreta opciones, espera pedidos y muestra resultados. No determina los criterios semánticos de aprobación.
- **Composición:** `main/` elige qué adaptadores usar y los inyecta. Es el lugar para cambiar las implementaciones reales.

Los contratos Solidity tienen su propio entorno de ejecución y restricciones. No se fuerza la estructura de carpetas de JavaScript dentro de la implementación de referencia. El contrato comprueba roles y transferencias; el caso de uso consulta al modelo y toma la decisión fuera de la cadena.

## Recorrido de una ejecución

1. `npm run agent` entra por `scripts/agent.mjs` y delega en la CLI.
2. `main/create-runtime.mjs` prepara el modelo elegido y la configuración de Sepolia; la CLI verifica acceso a la red.
3. `main/run-autonomous.mjs` conecta el caso de uso con repositorio y huellas.
4. `application/execute-job.mjs` consulta las reglas del dominio y coordina los puertos.
5. El adaptador de IA responde; el de Ethereum ejecuta las transacciones; el repositorio registra los avances.
6. El caso de uso devuelve el historial final y la CLI termina o espera otro pedido.

El dominio nunca importa infraestructura. La aplicación importa dominio y recibe los servicios; no crea directamente archivos, CLIs ni contratos.

## Decisiones de diseño

**Inversión de dependencias.** El caso de uso depende de operaciones como `repository.save()` y `model.ask()`, no de `fs.writeFile()` o de un comando de Claude. Las pruebas en memoria demuestran esa sustitución.

**Una responsabilidad por módulo.** Política, persistencia, IA y Ethereum viven en módulos distintos. Los scripts de npm son entradas pequeñas. `prepareDelivery()` separa el ciclo de generación y evaluación del flujo principal.

**Compatibilidad del taller.** Se conservan los comandos anteriores. `scripts/autonomy.mjs`, `scripts/model.mjs` y `scripts/protocol.mjs` son fachadas de compatibilidad, no implementaciones duplicadas. `workshop.mjs` es una herramienta manual de demostración del contrato; su ruta conserva una sesión separada.

**Comentarios y nombres.** Los comentarios explican intenciones, límites y pasos en español. Los identificadores de bibliotecas, estándares y puertos permanecen en inglés para conservar compatibilidad. No se agregan comentarios a JSON porque ese formato no los admite.

**Formato reproducible.** Prettier aplica el mismo estilo a JavaScript, configuración y Solidity. ESLint detecta errores frecuentes y prohíbe que el núcleo use directamente servicios del entorno. Las versiones de herramientas están fijadas en el lockfile.

## Validación

```sh
npm run format
npm run format:check
npm run lint
npm run test:architecture
npm run test:agent
npm run test:integration
```

`npm run verify` ejecuta las comprobaciones sin modificar el código, compila y prueba contratos en entornos EVM controlados. La integración usa puerto 18545 y respuestas de IA simuladas. Las pruebas del caso de uso también funcionan con repositorio y protocolo en memoria. La integración del adaptador Sepolia usa una EVM privada con chainId 11155111 y llaves efímeras: no equivale a un despliegue en la red pública.

Las pruebas de arquitectura comprueban que las importaciones del núcleo respeten las capas. No prueban por sí solas calidad de un modelo, resistencia a fallos distribuidos ni seguridad para operar dinero real.

## Límites deliberados

El agente procesa una tarea concreta. El bloqueo y la reserva de presupuesto presuponen un solo proceso por carpeta. El disco y una transacción minada no forman una transacción atómica conjunta: un corte en la ventana entre ambos puede requerir recuperación manual. Cambiar el almacenamiento no elimina automáticamente esa limitación.

Reiniciar Hardhat elimina la cadena local; pueden repetirse direcciones después del reinicio. No reanudar un historial viejo contra una cadena nueva solo porque coincide la dirección del contrato. La evaluación semántica sigue siendo probabilística y dos consultas al mismo proveedor no equivalen a dos organizaciones independientes.

## Sepolia pública

La composición utiliza Sepolia por defecto. `config/sepolia-config.mjs` lee las tres llaves desde `.env` y valida su formato sin imprimirlas. `ethereum/sepolia-protocol.mjs` reutiliza el protocolo y sustituye sus firmantes. `ethereum/sepolia-signer.mjs` verifica chainId 11155111, administra nonces y limita gas antes de firmar.

El dominio sigue sin importar ethers o variables de entorno. Los precios y límites de CAMPUS son reglas del dominio; los límites de gas y el transporte RPC son configuración del adaptador. `data/sepolia/` aísla despliegues, reservas y pedidos de la ruta local.

Los comandos `sepolia:doctor`, `sepolia:deploy` y `sepolia:fund-roles` son interfaces de preparación. Doctor solo lee; deploy publica contratos; fund-roles es una transferencia explícita opcional desde el cliente. Los contratos publicados persisten al cerrar el agente, pero la IA no permanece activa por ese motivo.

`.env` se excluye de Git y del ZIP. `.env.example` no contiene llaves. El archivo de despliegue solo contiene direcciones, cuentas públicas y recibos. La aplicación sigue sin ser un sistema de custodia ni un procesador de pagos de producción.

## Reputación posterior a la liquidación

`AgentReputation` adapta los registros oficiales ERC-8004 de Sepolia. La composición
ejecuta el feedback después del caso de uso de comercio; no modifica sus reglas de
pago ni devolución. La identidad pertenece al proveedor y firma feedback el evaluador.
Los registros de identidad y recibos quedan en `data/sepolia/`, excluido de Git.
La media se filtra por evaluador y etiquetas del taller; no es reputación independiente.
