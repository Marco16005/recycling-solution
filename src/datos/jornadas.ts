import { and, asc, eq } from "drizzle-orm";
import type { BD, Tx } from "./bd";
import { jornadas } from "./esquema";

/** disponibleDesde: "HH:MM". */
export interface JornadaGuardada {
  id: string;
  fecha: string;
  unidadId: string;
  operadorId: string;
  disponibleDesde: string;
  checkInEn: Date | null;
  checkOutEn: Date | null;
  notas: string | null;
  version: number;
}

const hhmm = (hora: string) => hora.slice(0, 5);

export async function leerJornadas(bd: BD | Tx, fecha: string): Promise<JornadaGuardada[]> {
  const filas = await bd.select().from(jornadas).where(eq(jornadas.fecha, fecha)).orderBy(asc(jornadas.disponibleDesde), asc(jornadas.id));
  return filas.map((j) => ({
    id: j.id,
    fecha: j.fecha,
    unidadId: j.unidadId,
    operadorId: j.operadorId,
    disponibleDesde: hhmm(j.disponibleDesde),
    checkInEn: j.checkInEn,
    checkOutEn: j.checkOutEn,
    notas: j.notas,
    version: j.version,
  }));
}

/** Bloquea las jornadas del día para que dos asignaciones simultáneas no se crucen. */
export async function bloquearJornadasDelDia(tx: Tx, fecha: string): Promise<void> {
  await tx.select({ id: jornadas.id }).from(jornadas).where(eq(jornadas.fecha, fecha)).for("update");
}

export async function insertarJornada(
  tx: Tx,
  datos: { fecha: string; unidadId: string; operadorId: string; disponibleDesde: string; notas: string | null },
  ahora: Date,
): Promise<string> {
  const [fila] = await tx.insert(jornadas).values({ ...datos, creadoEn: ahora, actualizadoEn: ahora }).returning({ id: jornadas.id });
  return fila.id;
}

export async function borrarJornadaSiVersion(tx: Tx, id: string, version: number): Promise<"borrada" | "no_encontrado" | "conflicto"> {
  const borradas = await tx.delete(jornadas).where(and(eq(jornadas.id, id), eq(jornadas.version, version))).returning({ id: jornadas.id });
  if (borradas.length > 0) return "borrada";
  const [existe] = await tx.select({ id: jornadas.id }).from(jornadas).where(eq(jornadas.id, id));
  return existe ? "conflicto" : "no_encontrado";
}
