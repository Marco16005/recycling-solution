import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Copia generada del worker de MapLibre (scripts/copiar-worker-mapa.mjs).
    "public/maplibre-gl-worker.mjs",
    // Worktrees de trabajo en paralelo y reportes de pruebas.
    ".worktrees/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
