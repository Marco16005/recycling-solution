import { defineConfig } from "drizzle-kit";

/** Solo genera migraciones (no se conecta). esquema.ts reexporta las tablas de Better Auth. */
export default defineConfig({
  schema: "./src/datos/esquema.ts",
  out: "./drizzle",
  dialect: "postgresql",
});
