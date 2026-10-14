import { eq } from "drizzle-orm";
import type { BD, Tx } from "./bd";
import { configuracion } from "./esquema";

export interface Configuracion {
  versionAvisoPrivacidad: string;
}

/** La fila única de configuración. La crea la migración de datos iniciales; si falta, la base está mal migrada. */
export async function leerConfiguracion(bd: BD | Tx): Promise<Configuracion> {
  const [fila] = await bd
    .select({ versionAvisoPrivacidad: configuracion.versionAvisoPrivacidad })
    .from(configuracion)
    .where(eq(configuracion.id, 1));
  if (!fila) throw new Error("Falta la fila de configuración: ejecuta el servicio migrate");
  return fila;
}
