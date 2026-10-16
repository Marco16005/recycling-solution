import { and, asc, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { EstadoJornada, EstadoParada, ViajeOperacion } from "@/dominio/operacion/tipos";
import type { BD, Tx } from "./bd";
import { eventosOperador, incidentes, jornadas, paradas, rutas, solicitudes } from "./esquema";

type Conexion = BD | Tx;

// ---------- Plan operativo (Plan 5, §2)

/** Ids del plan validado de la fecha y de todos sus antecesores reemplazados (siguiendo plan_base_id). Vacío si no hay validado. */
export async function planOperativo(bd: Conexion, fecha: string): Promise<string[]> {
  const filas = await bd.execute(sql`
    WITH RECURSIVE cadena AS (
      SELECT id, plan_base_id FROM planes WHERE fecha = ${fecha} AND estado = 'validado'
      UNION ALL
      SELECT p.id, p.plan_base_id FROM planes p JOIN cadena c ON p.id = c.plan_base_id WHERE p.estado = 'reemplazado'
    )
    SELECT id FROM cadena`);
  return (filas as unknown as { rows: { id: string }[] }).rows.map((f) => f.id);
}

export interface JornadaOperacion {
  id: string; fecha: string; unidadId: string; operadorId: string; checkInEn: Date | null; checkOutEn: Date | null; versionOperacion: number;
}

/** Bloquea la jornada (FOR UPDATE) y la devuelve. */
export async function bloquearJornada(tx: Tx, id: string): Promise<JornadaOperacion | null> {
  const [j] = await tx
    .select({
      id: jornadas.id, fecha: jornadas.fecha, unidadId: jornadas.unidadId, operadorId: jornadas.operadorId,
      checkInEn: jornadas.checkInEn, checkOutEn: jornadas.checkOutEn, versionOperacion: jornadas.versionOperacion,
    })
    .from(jornadas)
    .where(eq(jornadas.id, id))
    .for("update");
  return j ?? null;
}

export async function leerJornadaOperacion(bd: Conexion, id: string): Promise<JornadaOperacion | null> {
  const [j] = await bd
    .select({
      id: jornadas.id, fecha: jornadas.fecha, unidadId: jornadas.unidadId, operadorId: jornadas.operadorId,
      checkInEn: jornadas.checkInEn, checkOutEn: jornadas.checkOutEn, versionOperacion: jornadas.versionOperacion,
    })
    .from(jornadas)
    .where(eq(jornadas.id, id));
  return j ?? null;
}

/** Jornada del operador en la fecha, si tiene. */
export async function jornadaDelOperador(bd: Conexion, operadorId: string, fecha: string): Promise<JornadaOperacion | null> {
  const [j] = await bd
    .select({
      id: jornadas.id, fecha: jornadas.fecha, unidadId: jornadas.unidadId, operadorId: jornadas.operadorId,
      checkInEn: jornadas.checkInEn, checkOutEn: jornadas.checkOutEn, versionOperacion: jornadas.versionOperacion,
    })
    .from(jornadas)
    .where(and(eq(jornadas.operadorId, operadorId), eq(jornadas.fecha, fecha)));
  return j ?? null;
}

type FilaRuta = typeof rutas.$inferSelect;
type FilaParada = typeof paradas.$inferSelect;

/** Rutas operativas de la jornada con todas sus paradas. Con bloquear, rutas y paradas quedan FOR UPDATE (en orden de id). */
export async function rutasOperativas(
  bd: Conexion,
  jornadaId: string,
  planIds: string[],
  bloquear = false,
): Promise<{ ruta: FilaRuta; paradas: FilaParada[] }[]> {
  if (planIds.length === 0) return [];
  const consultaRutas = bd
    .select()
    .from(rutas)
    .where(and(eq(rutas.jornadaId, jornadaId), inArray(rutas.planId, planIds)))
    .orderBy(asc(rutas.id));
  const filasRutas = bloquear ? await consultaRutas.for("update") : await consultaRutas;
  if (filasRutas.length === 0) return [];
  const consultaParadas = bd
    .select()
    .from(paradas)
    .where(inArray(paradas.rutaId, filasRutas.map((r) => r.id)))
    .orderBy(asc(paradas.id));
  const filasParadas = bloquear ? await consultaParadas.for("update") : await consultaParadas;
  return filasRutas.map((ruta) => ({
    ruta,
    paradas: filasParadas.filter((p) => p.rutaId === ruta.id).sort((a, b) => a.secuencia - b.secuencia),
  }));
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Secuencia operativa (Plan 5, §2): rutas iniciadas o con alguna parada vigente; primero las iniciadas por su salida
 * real, luego las demás por su salida estimada.
 */
export function secuenciaOperativa(rs: { ruta: FilaRuta; paradas: FilaParada[] }[]): { ruta: FilaRuta; paradas: FilaParada[] }[] {
  return rs
    .filter((r) => r.ruta.salidaPatioEn !== null || r.paradas.some((p) => p.vigente))
    .sort((a, b) => {
      const sa = a.ruta.salidaPatioEn?.getTime() ?? Number.POSITIVE_INFINITY;
      const sb = b.ruta.salidaPatioEn?.getTime() ?? Number.POSITIVE_INFINITY;
      return sa - sb || a.ruta.salidaEstimada.getTime() - b.ruta.salidaEstimada.getTime() || (a.ruta.id < b.ruta.id ? -1 : 1);
    });
}

function comoViaje(r: { ruta: FilaRuta; paradas: FilaParada[] }): ViajeOperacion {
  return {
    rutaId: r.ruta.id,
    version: r.ruta.version,
    salidaEstimada: r.ruta.salidaEstimada.toISOString(),
    regresoEstimado: r.ruta.regresoEstimado.toISOString(),
    finDescargaEstimado: r.ruta.finDescargaEstimado.toISOString(),
    salidaPatioEn: iso(r.ruta.salidaPatioEn),
    regresoPatioEn: iso(r.ruta.regresoPatioEn),
    descargaFinEn: iso(r.ruta.descargaFinEn),
    odometroInicioKm: r.ruta.odometroInicioKm,
    paradas: r.paradas.map((p) => ({
      paradaId: p.id,
      solicitudId: p.solicitudId,
      secuencia: p.secuencia,
      estado: p.estado as EstadoParada,
      vigente: p.vigente,
      llegadaEstimada: p.llegadaEstimada.toISOString(),
      inicioEstimado: p.inicioEstimado.toISOString(),
      finEstimado: p.finEstimado.toISOString(),
      llegadaEn: iso(p.llegadaEn),
      inicioServicioEn: iso(p.inicioServicioEn),
      cierreEn: iso(p.cierreEn),
    })),
  };
}

/** Último odómetro registrado de la unidad, en cualquier jornada. */
export async function ultimoOdometroDeUnidad(bd: Conexion, unidadId: string): Promise<number | null> {
  const [fila] = await bd
    .select({ km: sql<number | null>`max(greatest(${rutas.odometroInicioKm}, ${rutas.odometroFinKm}))` })
    .from(rutas)
    .innerJoin(jornadas, eq(jornadas.id, rutas.jornadaId))
    .where(and(eq(jornadas.unidadId, unidadId), or(isNotNull(rutas.odometroInicioKm), isNotNull(rutas.odometroFinKm))));
  return fila?.km ?? null;
}

export async function ultimoEventoAplicado(bd: Conexion, jornadaId: string): Promise<{ tipo: string; en: Date } | null> {
  const [fila] = await bd
    .select({ tipo: eventosOperador.tipo, en: eventosOperador.ocurridoEn })
    .from(eventosOperador)
    .where(and(eq(eventosOperador.jornadaId, jornadaId), eq(eventosOperador.resultado, "aplicado")))
    .orderBy(desc(eventosOperador.ocurridoEn))
    .limit(1);
  return fila ?? null;
}

export async function ultimoOcurrido(bd: Conexion, jornadaId: string): Promise<Date | null> {
  const [fila] = await bd
    .select({ en: eventosOperador.ocurridoEn })
    .from(eventosOperador)
    .where(and(eq(eventosOperador.jornadaId, jornadaId), eq(eventosOperador.resultado, "aplicado")))
    .orderBy(desc(eventosOperador.ocurridoEn))
    .limit(1);
  return fila?.en ?? null;
}

/** Arma el EstadoJornada del dominio desde la base. Con bloquear, deja bloqueadas rutas y paradas operativas. */
export async function estadoDeJornada(bd: Conexion, j: JornadaOperacion, bloquear = false): Promise<EstadoJornada> {
  const planIds = await planOperativo(bd, j.fecha);
  const operativas = secuenciaOperativa(await rutasOperativas(bd, j.id, planIds, bloquear));
  return {
    jornadaId: j.id,
    fecha: j.fecha,
    checkInEn: iso(j.checkInEn),
    checkOutEn: iso(j.checkOutEn),
    ultimoOcurridoEn: iso(await ultimoOcurrido(bd, j.id)),
    ultimoOdometroKm: await ultimoOdometroDeUnidad(bd, j.unidadId),
    viajes: operativas.map(comoViaje),
  };
}

/** Con bloquear: FOR UPDATE, en orden de id. */
export async function paradasPorId(bd: Conexion, ids: string[], bloquear = false): Promise<FilaParada[]> {
  if (ids.length === 0) return [];
  const consulta = bd.select().from(paradas).where(inArray(paradas.id, ids)).orderBy(asc(paradas.id));
  return bloquear ? consulta.for("update") : consulta;
}

// ---------- Eventos

export type FilaEvento = typeof eventosOperador.$inferSelect;

export async function eventoPorId(bd: Conexion, eventoId: string): Promise<FilaEvento | null> {
  const [e] = await bd.select().from(eventosOperador).where(eq(eventosOperador.eventoId, eventoId));
  return e ?? null;
}

/** Las referencias que existen de verdad; las demás, null (para guardar un rechazo sin romper las llaves foráneas). */
export async function referenciasExistentes(bd: Conexion, rutaId: string | null, paradaId: string | null): Promise<{ rutaId: string | null; paradaId: string | null }> {
  const ruta = rutaId ? (await bd.select({ id: rutas.id }).from(rutas).where(eq(rutas.id, rutaId)))[0] : undefined;
  const parada = paradaId ? (await bd.select({ id: paradas.id }).from(paradas).where(eq(paradas.id, paradaId)))[0] : undefined;
  return { rutaId: ruta?.id ?? null, paradaId: parada?.id ?? null };
}

export async function insertarEvento(tx: Tx, e: typeof eventosOperador.$inferInsert): Promise<void> {
  await tx.insert(eventosOperador).values(e);
}

export async function subirVersionOperacion(tx: Tx, jornadaId: string): Promise<void> {
  await tx.update(jornadas).set({ versionOperacion: sql`${jornadas.versionOperacion} + 1` }).where(eq(jornadas.id, jornadaId));
}

export async function marcarJornada(tx: Tx, jornadaId: string, campo: "check_in_en" | "check_out_en", en: Date): Promise<void> {
  await tx.update(jornadas).set(campo === "check_in_en" ? { checkInEn: en } : { checkOutEn: en }).where(eq(jornadas.id, jornadaId));
}

export async function marcarRuta(
  tx: Tx,
  rutaId: string,
  campo: "salida_patio_en" | "regreso_patio_en" | "descarga_fin_en",
  en: Date,
  odometroKm: number | undefined,
): Promise<void> {
  const cambios =
    campo === "salida_patio_en" ? { salidaPatioEn: en, odometroInicioKm: odometroKm ?? null }
    : campo === "regreso_patio_en" ? { regresoPatioEn: en, odometroFinKm: odometroKm ?? null }
    : { descargaFinEn: en };
  await tx.update(rutas).set({ ...cambios, actualizadoEn: en }).where(eq(rutas.id, rutaId));
}

export async function marcarDisponibilidad(tx: Tx, rutaId: string, en: Date): Promise<void> {
  await tx.update(rutas).set({ disponibleParaSalirEn: en, actualizadoEn: en }).where(eq(rutas.id, rutaId));
}

export async function marcarParada(
  tx: Tx,
  paradaId: string,
  estado: EstadoParada,
  campos: ("llegada_en" | "inicio_servicio_en" | "fin_servicio_en" | "cierre_en")[],
  en: Date,
  motivo: string | undefined,
  liberar: boolean,
): Promise<void> {
  const horas = Object.fromEntries(
    campos.map((c) => [{ llegada_en: "llegadaEn", inicio_servicio_en: "inicioServicioEn", fin_servicio_en: "finServicioEn", cierre_en: "cierreEn" }[c], en]),
  );
  await tx
    .update(paradas)
    .set({ estado, ...horas, ...(motivo !== undefined ? { motivoNoAtendida: motivo } : {}), ...(liberar ? { vigente: false } : {}), actualizadoEn: en })
    .where(eq(paradas.id, paradaId));
}

/** Solicitudes de las paradas vigentes de la ruta: programada → en_ruta. */
export async function solicitudesEnRuta(tx: Tx, rutaId: string, en: Date): Promise<void> {
  const ids = tx.select({ id: paradas.solicitudId }).from(paradas).where(and(eq(paradas.rutaId, rutaId), eq(paradas.vigente, true)));
  await tx
    .update(solicitudes)
    .set({ estado: "en_ruta", version: sql`${solicitudes.version} + 1`, actualizadoEn: en })
    .where(and(inArray(solicitudes.id, ids), eq(solicitudes.estado, "programada")));
}

export async function solicitudDeParada(bd: Conexion, paradaId: string): Promise<string | null> {
  const [p] = await bd.select({ id: paradas.solicitudId }).from(paradas).where(eq(paradas.id, paradaId));
  return p?.id ?? null;
}

export async function solicitudAtendida(tx: Tx, solicitudId: string, en: Date): Promise<void> {
  await tx
    .update(solicitudes)
    .set({ estado: "atendida", version: sql`${solicitudes.version} + 1`, actualizadoEn: en })
    .where(eq(solicitudes.id, solicitudId));
}

/** No atendida: vuelve a pendiente para el siguiente día de operación, con una posposición más y su registro original. */
export async function solicitudAlSiguienteDia(tx: Tx, solicitudId: string, proximaFechaElegible: string, en: Date): Promise<void> {
  await tx
    .update(solicitudes)
    .set({
      estado: "pendiente", proximaFechaElegible, vecesPospuesta: sql`${solicitudes.vecesPospuesta} + 1`,
      version: sql`${solicitudes.version} + 1`, actualizadoEn: en,
    })
    .where(eq(solicitudes.id, solicitudId));
}

/** Bloquea (FOR UPDATE, en orden) las solicitudes de las paradas de la jornada, para aplicar sus efectos. */
export async function bloquearSolicitudesDeParadas(tx: Tx, paradaIds: string[]): Promise<void> {
  if (paradaIds.length === 0) return;
  const ids = tx.select({ id: paradas.solicitudId }).from(paradas).where(inArray(paradas.id, paradaIds));
  await tx.select({ id: solicitudes.id }).from(solicitudes).where(inArray(solicitudes.id, ids)).orderBy(asc(solicitudes.id)).for("update");
}

export async function eventosRechazadosSinConciliar(bd: Conexion, fecha: string) {
  return bd
    .select({
      eventoId: eventosOperador.eventoId, jornadaId: eventosOperador.jornadaId, tipo: eventosOperador.tipo,
      ocurridoEn: eventosOperador.ocurridoEn, motivoRechazo: eventosOperador.motivoRechazo,
    })
    .from(eventosOperador)
    .innerJoin(jornadas, eq(jornadas.id, eventosOperador.jornadaId))
    .where(and(eq(jornadas.fecha, fecha), eq(eventosOperador.resultado, "rechazado"), sql`${eventosOperador.conciliadoEn} IS NULL`))
    .orderBy(asc(eventosOperador.ocurridoEn));
}

export async function conciliar(tx: Tx, eventoId: string, por: string, nota: string, en: Date): Promise<boolean> {
  const filas = await tx
    .update(eventosOperador)
    .set({ conciliadoEn: en, conciliadoPor: por, notaConciliacion: nota })
    .where(and(eq(eventosOperador.eventoId, eventoId), eq(eventosOperador.resultado, "rechazado"), sql`${eventosOperador.conciliadoEn} IS NULL`))
    .returning({ id: eventosOperador.id });
  return filas.length > 0;
}

// ---------- Incidentes

export type FilaIncidente = typeof incidentes.$inferSelect;

export async function incidentePorEvento(bd: Conexion, eventoId: string): Promise<FilaIncidente | null> {
  const [i] = await bd.select().from(incidentes).where(eq(incidentes.eventoId, eventoId));
  return i ?? null;
}

export async function insertarIncidente(tx: Tx, i: typeof incidentes.$inferInsert): Promise<string> {
  const [fila] = await tx.insert(incidentes).values(i).returning({ id: incidentes.id });
  return fila.id;
}

export async function incidentePorId(bd: Conexion, id: string): Promise<FilaIncidente | null> {
  const [i] = await bd.select().from(incidentes).where(eq(incidentes.id, id));
  return i ?? null;
}

export async function leerIncidenteParaCambiar(tx: Tx, id: string): Promise<FilaIncidente | null> {
  const [i] = await tx.select().from(incidentes).where(eq(incidentes.id, id)).for("update");
  return i ?? null;
}

export async function resolverIncidenteSiVersion(
  tx: Tx,
  id: string,
  version: number,
  accion: "continuar" | "cancelar" | "re_ruteo",
  por: string,
  en: Date,
): Promise<number | null> {
  const [fila] = await tx
    .update(incidentes)
    .set({ accion, resueltoEn: en, resueltoPor: por, version: sql`${incidentes.version} + 1`, actualizadoEn: en })
    .where(and(eq(incidentes.id, id), eq(incidentes.version, version), sql`${incidentes.resueltoEn} IS NULL`))
    .returning({ version: incidentes.version });
  return fila?.version ?? null;
}

export async function incidentesAbiertos(bd: Conexion, fecha: string) {
  return bd
    .select({
      id: incidentes.id, version: incidentes.version, jornadaId: incidentes.jornadaId, paradaId: incidentes.paradaId,
      tipo: incidentes.tipo, descripcion: incidentes.descripcion, reportadoEn: incidentes.reportadoEn,
    })
    .from(incidentes)
    .innerJoin(jornadas, eq(jornadas.id, incidentes.jornadaId))
    .where(and(eq(jornadas.fecha, fecha), sql`${incidentes.resueltoEn} IS NULL`))
    .orderBy(asc(incidentes.reportadoEn));
}

