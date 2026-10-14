import { desc, eq } from "drizzle-orm";
import type { AccionPrivacidad, EstadoPrivacidad, MedioPrivacidad } from "@/dominio/clientes/tipos";
import type { BD, Tx } from "./bd";
import { aceptacionesPrivacidad } from "./esquema";

export interface MovimientoPrivacidad {
  clienteId: string;
  versionAviso: string;
  accion: AccionPrivacidad;
  medio: MedioPrivacidad;
  registradoPor: string | null;
  en: Date;
}

/** Último movimiento del cliente según el orden total de `secuencia`; null si no hay. */
export async function ultimoMovimientoPrivacidad(bd: BD | Tx, clienteId: string): Promise<EstadoPrivacidad | null> {
  const [m] = await bd
    .select()
    .from(aceptacionesPrivacidad)
    .where(eq(aceptacionesPrivacidad.clienteId, clienteId))
    .orderBy(desc(aceptacionesPrivacidad.secuencia))
    .limit(1);
  return m ? { id: m.id, accion: m.accion, versionAviso: m.versionAviso, medio: m.medio, en: m.en } : null;
}

/** Agrega un movimiento; la tabla es de solo inserción. */
export async function insertarMovimientoPrivacidad(tx: Tx, movimiento: MovimientoPrivacidad): Promise<EstadoPrivacidad> {
  const [m] = await tx.insert(aceptacionesPrivacidad).values(movimiento).returning();
  return { id: m.id, accion: m.accion, versionAviso: m.versionAviso, medio: m.medio, en: m.en };
}
