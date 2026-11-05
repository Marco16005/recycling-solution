import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // Plan de seguridad: las pruebas generan muchos planes seguidos con el mismo usuario; el límite de frecuencia se
    // prueba encendido en src/seguridad/limites.test.ts y src/acciones/limite-motor.integracion.test.ts.
    env: { LIMITAR_ACCIONES: "no" },
    projects: [
      {
        extends: true,
        test: {
          name: "unidad",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.integracion.test.ts"],
          // Varios archivos usan Postgres en memoria (PGlite). Con 4 o más procesos a la vez, algunos se quedaban
          // colgados al crear la base (observado en Docker Desktop, 12 CPU y 8 GB); con 2 la suite completa tarda ~15 s.
          maxWorkers: 2,
          hookTimeout: 30_000,
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
