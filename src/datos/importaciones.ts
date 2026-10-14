import { eq } from "drizzle-orm";
import type { Tx } from "./bd";
import { importaciones } from "./esquema";

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
