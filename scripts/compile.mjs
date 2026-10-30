/**
 * Compilador del taller. Convierte Solidity en ABI (interfaz para llamadas)
 * y bytecode (programa desplegable). Los resultados se escriben en build/.
 */

import fs from "node:fs";
import path from "node:path";
import solc from "solc";
// Crea el destino de los artefactos sin fallar si ya existe.
fs.mkdirSync("build", { recursive: true });
// Lee todos los contratos propios; las dependencias se resuelven en el callback import.
const sources = Object.fromEntries(
  fs
    .readdirSync("contracts")
    .filter((n) => n.endsWith(".sol"))
    .map((n) => [n, { content: fs.readFileSync("contracts/" + n, "utf8") }]),
);
// Ejecuta solc con salida ABI y bytecode. Cancun permite el almacenamiento
// transitorio que usa la protección contra reentradas del contrato de referencia.
const output = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: "Solidity",
      sources,
      settings: {
        // La versión EVM debe ser compatible con las instrucciones usadas por los contratos.
        evmVersion: "cancun",
        optimizer: { enabled: true, runs: 200 },
        outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
      },
    }),
    {
      // Resuelve importaciones de OpenZeppelin y archivos locales sin descargarlas aquí.
      import(p) {
        for (const root of ["node_modules", "contracts"]) {
          const f = path.join(root, p);
          if (fs.existsSync(f)) return { contents: fs.readFileSync(f, "utf8") };
        }
        return { error: "No encontrado: " + p };
      },
    },
  ),
);
// Detiene la compilación ante errores de Solidity; no confunde advertencias con errores.
const errors = (output.errors ?? []).filter((e) => e.severity === "error");
if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
// Guarda solo contratos desplegables; interfaces sin bytecode no necesitan artefacto.
for (const cs of Object.values(output.contracts))
  for (const [name, c] of Object.entries(cs))
    if (c.evm.bytecode.object)
      fs.writeFileSync(
        "build/" + name + ".json",
        JSON.stringify({ abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }),
      );
console.log("Contratos compilados con Solidity " + solc.version());
