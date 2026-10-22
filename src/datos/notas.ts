import { desc, eq } from "drizzle-orm";
import type { BD, Tx } from "./bd";
import { notasCliente } from "./esquema";

/** Plan CRM, §4.8: notas de seguimiento. Solo se agregan (rs_app no tiene UPDATE ni DELETE). */

export type FilaNota = typeof notasCliente.$inferSelect;
export interface NuevaNota { clienteId: string; tipo: FilaNota["tipo"]; texto: string; autor: string; corrigeA: string | null }

export async function insertarNota(tx: Tx, n: NuevaNota, en: Date): Promise<string> {
  const [fila] = await tx.insert(notasCliente).values({ ...n, en }).returning({ id: notasCliente.id });
  return fila.id;
}

/** Supresión (derecho ARCO): solo con la conexión del migrador; rs_app no tiene DELETE. Devuelve cuántas borró. */
export async function suprimirNotasDeCliente(tx: Tx, clienteId: string): Promise<number> {
  const borradas = await tx.delete(notasCliente).where(eq(notasCliente.clienteId, clienteId)).returning({ id: notasCliente.id });
  return borradas.length;
}

/** Más recientes primero. */
export async function notasDeCliente(bd: BD | Tx, clienteId: string): Promise<FilaNota[]> {
  return bd.select().from(notasCliente).where(eq(notasCliente.clienteId, clienteId)).orderBy(desc(notasCliente.en), desc(notasCliente.id));
}
