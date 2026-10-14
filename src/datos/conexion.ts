import "server-only";
import type { BD } from "./bd";
import { crearConexion } from "./conexion-base";

let bd: BD | null = null;

/** Conexión de la aplicación (rol rs_app). Se crea al primer uso, no al compilar. */
export function bdDeLaAplicacion(): BD {
  bd ??= crearConexion(process.env.DATABASE_URL ?? "").bd;
  return bd;
}
