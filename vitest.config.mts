import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unidad",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.integracion.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integracion",
          environment: "node",
          include: ["src/**/*.integracion.test.ts"],
          // Cada archivo crea su propia base; se ejecutan uno tras otro para no saturar Postgres.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
