import { crearConexion } from "../src/datos/conexion-base";

export { claveAleatoria } from "../src/seguridad/claves";

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

/** Ejecuta el script y termina con código 1 y un mensaje legible si falla. */
export async function ejecutar(script: () => Promise<void>): Promise<void> {
  try {
    await script();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
