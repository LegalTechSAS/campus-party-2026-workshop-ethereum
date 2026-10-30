/** Verifica la dirección de las dependencias del núcleo. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));

// Las reglas solo dependen del dominio. La aplicación puede usar dominio y
// aplicación, pero no modelos, archivos, CLIs o Ethereum concretos.
for (const layer of ["domain", "application"]) {
  test(`la capa ${layer} no depende de infraestructura o interfaces`, async () => {
    for (const name of await fs.readdir(path.join(sourceRoot, layer))) {
      if (!name.endsWith(".mjs")) continue;
      const code = await fs.readFile(path.join(sourceRoot, layer, name), "utf8");
      for (const match of code.matchAll(
        /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/gu,
      )) {
        const dependency = match[1];
        assert.ok(
          dependency.startsWith("."),
          `${name}: dependencia externa ${dependency}`,
        );
        const destination = path.resolve(sourceRoot, layer, dependency);
        const allowed = [path.join(sourceRoot, "domain")];
        if (layer === "application") allowed.push(path.join(sourceRoot, "application"));
        assert.ok(
          allowed.some((folder) => destination.startsWith(folder + path.sep)),
          `${name}: dependencia hacia fuera del núcleo`,
        );
      }
    }
  });
}
