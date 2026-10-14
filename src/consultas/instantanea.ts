import type { BD, Tx } from "@/datos/bd";

/** Lectura coherente de varias tablas: una sola instantánea de solo lectura. */
export function leerInstantanea<T>(bd: BD, lectura: (tx: Tx) => Promise<T>): Promise<T> {
  return bd.transaction(lectura, { isolationLevel: "repeatable read", accessMode: "read only" });
}
