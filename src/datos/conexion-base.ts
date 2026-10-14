import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { BD } from "./bd";
import * as esquema from "./esquema";

/** Conexión a Postgres para la aplicación, los scripts y las pruebas de integración. */
export function crearConexion(url: string, maxConexiones = 5): { bd: BD; cerrar: () => Promise<void> } {
  if (!url) throw new Error("Falta la URL de la base de datos");
  const pool = new Pool({ connectionString: url, max: maxConexiones });
  return { bd: drizzle(pool, { schema: esquema }), cerrar: () => pool.end() };
}
