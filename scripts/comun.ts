import { randomBytes } from "node:crypto";
import { crearConexion } from "../src/datos/conexion-base";

/** Conexión como rs_app para los scripts de administración. Se cierra al terminar. */
export async function conBase<T>(trabajo: (bd: ReturnType<typeof crearConexion>["bd"]) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL");
  const { bd, cerrar } = crearConexion(url, 1);
  try {
    return await trabajo(bd);
  } finally {
    await cerrar();
  }
}

/** Contraseña aleatoria de 20 caracteres (letras y números) para entregar en persona. */
export function claveAleatoria(): string {
  return randomBytes(15).toString("base64url").replace(/[-_]/g, "x").slice(0, 20);
}

/** Ejecuta el script y termina con código 1 y un mensaje legible si falla. */
export async function ejecutar(script: () => Promise<void>): Promise<void> {
  try {
    await script();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
