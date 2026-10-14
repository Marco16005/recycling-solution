import { eq, sql } from "drizzle-orm";
import type { Tx } from "./bd";
import { importaciones } from "./esquema";

/** Llave del candado que serializa las importaciones de clientes. */
const CANDADO_IMPORTACION = 727_002;

/** Espera a que termine cualquier otra importación; el candado se suelta al terminar la transacción. */
export async function tomarCandadoDeImportacion(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${CANDADO_IMPORTACION})`);
}

export async function buscarImportacion(tx: Tx, id: string): Promise<{ importados: number; huella: string } | null> {
  const [fila] = await tx
    .select({ importados: importaciones.importados, huella: importaciones.huella })
    .from(importaciones)
    .where(eq(importaciones.id, id));
  return fila ?? null;
}

export async function registrarImportacion(
  tx: Tx,
  datos: { id: string; usuarioId: string; huella: string; importados: number; en: Date },
): Promise<void> {
  await tx.insert(importaciones).values(datos);
}
