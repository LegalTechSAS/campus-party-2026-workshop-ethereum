/** Reglas de calidad y separación de capas para el código JavaScript del taller. */
import js from "@eslint/js";
import globals from "globals";

// Excluye dependencias y archivos generados; revisa solo fuentes y pruebas.
export default [
  { ignores: ["node_modules/**", "build/**", "data/**", "inbox/**", "processed/**"] },
  js.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2022,
        fetch: "readonly",
        AbortSignal: "readonly",
      },
    },
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  // El núcleo no debe usar directamente sistema operativo, terminal ni proveedores.
  {
    files: ["src/domain/**/*.mjs", "src/application/**/*.mjs"],
    rules: {
      "no-restricted-globals": ["error", "process", "console", "fetch"],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "node:*",
            "ethers",
            "**/infrastructure/**",
            "**/interfaces/**",
            "**/main/**",
          ],
        },
      ],
    },
  },
];
