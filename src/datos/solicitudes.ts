import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { Canal, SolicitudGuardada } from "@/dominio/solicitudes/tipos";
import type { BD, Tx } from "./bd";
import { foliosDia, paradas, planes, rutas, solicitudes } from "./esquema";

/** Siguiente consecutivo del día; concurrente y sin repetirse (el renglón queda bloqueado hasta terminar la transacción). */
export async function siguienteConsecutivo(tx: Tx, fecha: string): Promise<number> {
  const [fila] = await tx
    .insert(foliosDia)
    .values({ fecha, ultimo: 1 })
    .onConflictDoUpdate({ target: foliosDia.fecha, set: { ultimo: sql`${foliosDia.ultimo} + 1` } })
    .returning({ ultimo: foliosDia.ultimo });
  return fila.ultimo;
}

export interface NuevaSolicitud {
  folio: string;
  clienteId: string;
  registradaEn: Date;
  registradaPor: string;
  fechaSolicitada: string;
  canal: Canal;
  cargaEstimadaKg: number | null;
  notas: string | null;
  capturaInicioEn: Date | null;
  capturaFinEn: Date;
}

export async function insertarSolicitud(tx: Tx, s: NuevaSolicitud): Promise<string> {
  const [fila] = await tx
    .insert(solicitudes)
    .values({ ...s, proximaFechaElegible: s.fechaSolicitada, creadoEn: s.registradaEn, actualizadoEn: s.registradaEn })
    .returning({ id: solicitudes.id });
  return fila.id;
}

function comoGuardada(f: typeof solicitudes.$inferSelect): SolicitudGuardada {
  return {
    id: f.id,
    version: f.version,
    folio: f.folio,
    clienteId: f.clienteId,
    registradaEn: f.registradaEn,
    fechaSolicitada: f.fechaSolicitada,
    proximaFechaElegible: f.proximaFechaElegible,
    canal: f.canal,
    cargaEstimadaKg: f.cargaEstimadaKg,
    notas: f.notas,
    estado: f.estado,
    motivoCancelacion: f.motivoCancelacion,
    vecesPospuesta: f.vecesPospuesta,
  };
}

/**
 * Pendientes de cualquier fecha, las de fecha solicitada igual a la consultada y las que tienen parada vigente en el plan
 * validado de esa fecha (aunque se hayan solicitado otro día), en orden FIFO.
 */
export async function leerSolicitudesParaCola(bd: BD | Tx, fecha: string): Promise<SolicitudGuardada[]> {
  const programadasEnLaFecha = bd
    .select({ id: paradas.solicitudId })
    .from(paradas)
    .innerJoin(rutas, eq(rutas.id, paradas.rutaId))
    .innerJoin(planes, eq(planes.id, rutas.planId))
    .where(and(eq(paradas.vigente, true), eq(planes.fecha, fecha), eq(planes.estado, "validado")));
  const filas = await bd
    .select()
    .from(solicitudes)
    .where(or(eq(solicitudes.estado, "pendiente"), eq(solicitudes.fechaSolicitada, fecha), inArray(solicitudes.id, programadasEnLaFecha)))
    .orderBy(asc(solicitudes.registradaEn), asc(solicitudes.folio));
  return filas.map(comoGuardada);
}

export async function leerSolicitud(bd: BD | Tx, id: string): Promise<SolicitudGuardada | null> {
  const [fila] = await bd.select().from(solicitudes).where(eq(solicitudes.id, id));
  return fila ? comoGuardada(fila) : null;
}

export type ResultadoCambioSolicitud = "actualizada" | "no_encontrado" | "conflicto" | "no_pendiente";

/** Aplica el cambio solo si la versión coincide y la solicitud sigue pendiente. */
export async function actualizarSolicitudPendiente(
  tx: Tx,
  id: string,
  version: number,
  cambios: Partial<Pick<typeof solicitudes.$inferInsert, "estado" | "motivoCancelacion" | "fechaSolicitada" | "proximaFechaElegible">>,
  ahora: Date,
): Promise<ResultadoCambioSolicitud> {
  const [fila] = await tx
    .update(solicitudes)
    .set({ ...cambios, actualizadoEn: ahora, version: sql`${solicitudes.version} + 1` })
    .where(and(eq(solicitudes.id, id), eq(solicitudes.version, version), eq(solicitudes.estado, "pendiente")))
    .returning({ id: solicitudes.id });
  if (fila) return "actualizada";
  const actual = await leerSolicitud(tx, id);
  if (!actual) return "no_encontrado";
  return actual.version !== version ? "conflicto" : "no_pendiente";
}
