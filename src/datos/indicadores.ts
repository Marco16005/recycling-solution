import { and, asc, between, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Plan } from "@/motor";
import type { BD, Tx } from "./bd";
import { clientes, ejecucionesMotor, instantaneasK5, jornadas, paradas, planes, rutas, solicitudes, unidades } from "./esquema";

type Conexion = BD | Tx;

/** Datos crudos de los indicadores de un rango de fechas (Plan 6, §2), leídos en la misma instantánea. */
export interface DatosIndicadores {
  planes: { id: string; fecha: string; tipo: "inicial" | "re_ruteo"; generadoEn: Date; revisionIniciadaEn: Date | null; validadoEn: Date; resumen: Plan["resumen"] }[];
  rutas: (typeof rutas.$inferSelect & { placa: string })[];
  paradas: (typeof paradas.$inferSelect & { folio: string; cliente: string; fecha: string })[];
  capturasSeg: number[];
  ejecuciones: { duracionMs: number; resultado: "ok" | "error" | "tiempo_agotado" }[];
  serieK5: { fecha: string; activos: number; completos: number }[];
}

/** Planes con validado_en (validados o reemplazados) del rango, con sus rutas y paradas. */
export async function leerDatosIndicadores(bd: Conexion, desde: string, hasta: string): Promise<DatosIndicadores> {
  const filasPlanes = await bd
    .select({
      id: planes.id, fecha: planes.fecha, tipo: planes.tipo, generadoEn: planes.generadoEn,
      revisionIniciadaEn: planes.revisionIniciadaEn, validadoEn: planes.validadoEn, resultado: planes.resultado,
    })
    .from(planes)
    .where(and(between(planes.fecha, desde, hasta), isNotNull(planes.validadoEn)))
    .orderBy(asc(planes.fecha), asc(planes.validadoEn));
  const planIds = filasPlanes.map((p) => p.id);

  const filasRutas = planIds.length === 0 ? [] : await bd
    .select({ ruta: rutas, placa: unidades.placa })
    .from(rutas)
    .innerJoin(jornadas, eq(jornadas.id, rutas.jornadaId))
    .innerJoin(unidades, eq(unidades.id, jornadas.unidadId))
    .where(inArray(rutas.planId, planIds))
    .orderBy(asc(rutas.id));
  const rutaIds = filasRutas.map((r) => r.ruta.id);

  const filasParadas = rutaIds.length === 0 ? [] : await bd
    .select({ parada: paradas, folio: solicitudes.folio, cliente: clientes.nombre, fecha: planes.fecha })
    .from(paradas)
    .innerJoin(solicitudes, eq(solicitudes.id, paradas.solicitudId))
    .innerJoin(clientes, eq(clientes.id, solicitudes.clienteId))
    .innerJoin(rutas, eq(rutas.id, paradas.rutaId))
    .innerJoin(planes, eq(planes.id, rutas.planId))
    .where(inArray(paradas.rutaId, rutaIds))
    .orderBy(asc(paradas.rutaId), asc(paradas.secuencia));

  const capturas = await bd
    .select({ seg: sql<number>`extract(epoch FROM ${solicitudes.capturaFinEn} - ${solicitudes.capturaInicioEn})::float8` })
    .from(solicitudes)
    .where(and(
      isNotNull(solicitudes.capturaInicioEn), isNotNull(solicitudes.capturaFinEn),
      sql`(${solicitudes.registradaEn} AT TIME ZONE 'America/Mexico_City')::date BETWEEN ${desde}::date AND ${hasta}::date`,
    ));

  const ejecuciones = await bd
    .select({ duracionMs: ejecucionesMotor.duracionMs, resultado: ejecucionesMotor.resultado })
    .from(ejecucionesMotor)
    .where(between(ejecucionesMotor.fecha, desde, hasta));

  const serieK5 = await bd
    .select({ fecha: instantaneasK5.fecha, activos: instantaneasK5.activos, completos: instantaneasK5.completos })
    .from(instantaneasK5)
    .where(between(instantaneasK5.fecha, desde, hasta))
    .orderBy(asc(instantaneasK5.fecha));

  return {
    planes: filasPlanes.map((p) => ({ ...p, validadoEn: p.validadoEn!, resumen: p.resultado.resumen })),
    rutas: filasRutas.map((r) => ({ ...r.ruta, placa: r.placa })),
    paradas: filasParadas.map((p) => ({ ...p.parada, folio: p.folio, cliente: p.cliente, fecha: p.fecha })),
    capturasSeg: capturas.map((c) => Number(c.seg)),
    ejecuciones,
    serieK5,
  };
}

/** Guarda la instantánea de K5 de la fecha si todavía no hay una (la primera del día queda). */
export async function tomarInstantaneaK5(tx: Tx, fecha: string, activos: number, completos: number, ahora: Date): Promise<boolean> {
  const filas = await tx
    .insert(instantaneasK5)
    .values({ fecha, activos, completos, tomadaEn: ahora })
    .onConflictDoNothing({ target: instantaneasK5.fecha })
    .returning({ fecha: instantaneasK5.fecha });
  return filas.length > 0;
}
