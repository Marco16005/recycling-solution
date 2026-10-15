import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { VersionesPlan } from "@/dominio/plan/tipos";
import type { AjusteManual, EntradaPlan, Plan } from "@/motor";
import type { BD, Tx } from "./bd";
import { ejecucionesMotor, paradas, planes, rutas, solicitudes } from "./esquema";

type Conexion = BD | Tx;

/** Candados de Postgres del plan del día (Plan 4, §4). Las llaves de dos enteros no chocan con las de un entero. */
const CANDADO_FECHA = 727_005;
const CANDADO_CATALOGO_FLOTA = 727_006;

/**
 * Candado de la fecha hasta el fin de la transacción. Lo toman, antes que cualquier otro bloqueo, guardar una
 * generación, ajustar, descartar, validar, asignar jornada y quitar jornada.
 */
export async function tomarCandadoDeFecha(tx: Tx, fecha: string): Promise<void> {
  const llave = Number(fecha.replaceAll("-", ""));
  if (!Number.isInteger(llave)) throw new Error("Fecha no válida para el candado");
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${CANDADO_FECHA}::int, ${llave}::int)`);
}

/**
 * Candado del catálogo de flota: compartido al validar un plan (protege las capacidades máximas por tipo) y exclusivo
 * al dar de alta o editar una unidad, antes de tocar su renglón.
 */
export async function tomarCandadoDeCatalogoFlota(tx: Tx, modo: "compartido" | "exclusivo"): Promise<void> {
  if (modo === "compartido") await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${CANDADO_CATALOGO_FLOTA})`);
  else await tx.execute(sql`SELECT pg_advisory_xact_lock(${CANDADO_CATALOGO_FLOTA})`);
}

/** Restricciones de un plan de re-ruteo: jornadas que dejaron de estar disponibles, viajes conservados y paradas congeladas. */
export interface RestriccionesReruteo { jornadasNoDisponibles: string[]; admitidas: Record<string, string[][]>; congeladas: string[] }

/** Un ajuste manual con su autor y su hora (planes.ajustes). */
export interface AjusteRegistrado { ajuste: AjusteManual; por: string; en: string }

export interface PlanGuardado {
  id: string;
  fecha: string;
  estado: "propuesto" | "validado" | "descartado" | "reemplazado";
  tipo: "inicial" | "re_ruteo";
  planBaseId: string | null;
  /** Solo en un re-ruteo (Plan 5, §2). */
  restricciones: RestriccionesReruteo | null;
  version: number;
  generadoEn: Date;
  generadoPor: string;
  revisionIniciadaEn: Date | null;
  validadoEn: Date | null;
  validadoPor: string | null;
  descartadoEn: Date | null;
  requisitosConfirmadosEn: Date | null;
  semilla: number;
  versionMotor: string;
  entrada: EntradaPlan;
  versiones: VersionesPlan;
  resultado: Plan;
  ajustes: AjusteRegistrado[];
}

function comoPlan(f: typeof planes.$inferSelect): PlanGuardado {
  return {
    id: f.id,
    fecha: f.fecha,
    estado: f.estado,
    tipo: f.tipo,
    planBaseId: f.planBaseId,
    restricciones: f.restricciones as RestriccionesReruteo | null,
    version: f.version,
    generadoEn: f.generadoEn,
    generadoPor: f.generadoPor,
    revisionIniciadaEn: f.revisionIniciadaEn,
    validadoEn: f.validadoEn,
    validadoPor: f.validadoPor,
    descartadoEn: f.descartadoEn,
    requisitosConfirmadosEn: f.requisitosConfirmadosEn,
    semilla: f.semilla,
    versionMotor: f.versionMotor,
    entrada: f.entrada,
    versiones: f.versiones as VersionesPlan,
    resultado: f.resultado,
    ajustes: f.ajustes as AjusteRegistrado[],
  };
}

export async function leerPlan(bd: Conexion, id: string): Promise<PlanGuardado | null> {
  const [fila] = await bd.select().from(planes).where(eq(planes.id, id));
  return fila ? comoPlan(fila) : null;
}

/** Bloquea el plan hasta el fin de la transacción. */
export async function leerPlanParaCambiar(tx: Tx, id: string): Promise<PlanGuardado | null> {
  const [fila] = await tx.select().from(planes).where(eq(planes.id, id)).for("update");
  return fila ? comoPlan(fila) : null;
}

/** El validado de la fecha o, si no hay, el propuesto vigente. */
export async function leerPlanVigente(bd: Conexion, fecha: string): Promise<PlanGuardado | null> {
  const filas = await bd
    .select()
    .from(planes)
    .where(and(eq(planes.fecha, fecha), inArray(planes.estado, ["validado", "propuesto"])));
  const fila = filas.find((p) => p.estado === "validado") ?? filas[0];
  return fila ? comoPlan(fila) : null;
}

/** Identidad del propuesto vigente de la fecha: la "generación esperada" que se compara al guardar otra. */
export async function propuestoDeFecha(bd: Conexion, fecha: string): Promise<{ id: string; version: number } | null> {
  const [fila] = await bd
    .select({ id: planes.id, version: planes.version })
    .from(planes)
    .where(and(eq(planes.fecha, fecha), eq(planes.estado, "propuesto")));
  return fila ?? null;
}

export async function hayValidado(bd: Conexion, fecha: string): Promise<boolean> {
  const [fila] = await bd.select({ id: planes.id }).from(planes).where(and(eq(planes.fecha, fecha), eq(planes.estado, "validado")));
  return fila !== undefined;
}

/** Versiones de un re-ruteo: las del Plan 4 más el plan base y la operación de cada jornada (Plan 5, §4). */
export interface VersionesReruteo extends VersionesPlan { planBase: { id: string; version: number }; operacion: Record<string, number> }

export interface NuevoPlan {
  fecha: string;
  generadoEn: Date;
  generadoPor: string;
  semilla: number;
  versionMotor: string;
  entrada: EntradaPlan;
  versiones: VersionesPlan | VersionesReruteo;
  resultado: Plan;
  /** Solo un re-ruteo. */
  reruteo?: { planBaseId: string; restricciones: RestriccionesReruteo };
}

export async function insertarPlan(tx: Tx, p: NuevoPlan): Promise<string> {
  const { reruteo, ...datos } = p;
  const [fila] = await tx
    .insert(planes)
    .values({
      ...datos,
      ...(reruteo ? { tipo: "re_ruteo" as const, planBaseId: reruteo.planBaseId, restricciones: reruteo.restricciones } : {}),
      creadoEn: p.generadoEn,
      actualizadoEn: p.generadoEn,
    })
    .returning({ id: planes.id });
  return fila.id;
}

/** Descarta el propuesto (sin comprobar versión: lo usa una generación nueva tras comprobar la generación esperada). */
export async function descartarPropuesto(tx: Tx, id: string, ahora: Date): Promise<void> {
  await tx
    .update(planes)
    .set({ estado: "descartado", descartadoEn: ahora, actualizadoEn: ahora, version: sql`${planes.version} + 1` })
    .where(and(eq(planes.id, id), eq(planes.estado, "propuesto")));
}

/** Fija revision_iniciada_en una sola vez, sin cambiar la versión. true solo si la fijó ahora (plan propuesto y sin revisión). */
export async function fijarRevisionIniciada(tx: Tx, id: string, ahora: Date): Promise<boolean> {
  const filas = await tx
    .update(planes)
    .set({ revisionIniciadaEn: ahora })
    .where(and(eq(planes.id, id), eq(planes.estado, "propuesto"), isNull(planes.revisionIniciadaEn)))
    .returning({ id: planes.id });
  return filas.length > 0;
}

/** Guarda un ajuste: resultado y entrada nuevos, el historial y la revisión iniciada si faltaba. Llamar con el plan bloqueado. */
export async function guardarAjuste(
  tx: Tx,
  id: string,
  cambios: { resultado: Plan; entrada: EntradaPlan; ajustes: AjusteRegistrado[] },
  ahora: Date,
): Promise<number> {
  const [fila] = await tx
    .update(planes)
    .set({
      resultado: cambios.resultado,
      entrada: cambios.entrada,
      ajustes: cambios.ajustes,
      revisionIniciadaEn: sql`COALESCE(${planes.revisionIniciadaEn}, ${ahora.toISOString()}::timestamptz)`,
      actualizadoEn: ahora,
      version: sql`${planes.version} + 1`,
    })
    .where(eq(planes.id, id))
    .returning({ version: planes.version });
  return fila.version;
}

/** Marca el plan validado. Llamar con el plan bloqueado y todo comprobado. */
export async function marcarValidado(tx: Tx, id: string, por: string, ahora: Date): Promise<void> {
  await tx
    .update(planes)
    .set({ estado: "validado", validadoEn: ahora, validadoPor: por, requisitosConfirmadosEn: ahora, actualizadoEn: ahora, version: sql`${planes.version} + 1` })
    .where(eq(planes.id, id));
}

/** El plan base de un re-ruteo pasa a reemplazado (antes de validar el nuevo: un solo validado por fecha). */
export async function marcarReemplazado(tx: Tx, id: string, ahora: Date): Promise<void> {
  await tx
    .update(planes)
    .set({ estado: "reemplazado", actualizadoEn: ahora, version: sql`${planes.version} + 1` })
    .where(and(eq(planes.id, id), eq(planes.estado, "validado")));
}

/** Bloquea (FOR UPDATE, en orden de id) los planes dados. */
export async function bloquearPlanes(tx: Tx, ids: string[]): Promise<{ id: string; estado: string; version: number }[]> {
  if (ids.length === 0) return [];
  return tx.select({ id: planes.id, estado: planes.estado, version: planes.version }).from(planes).where(inArray(planes.id, ids)).orderBy(asc(planes.id)).for("update");
}

/** Marca el plan descartado. Llamar con el plan bloqueado. */
export async function marcarDescartado(tx: Tx, id: string, ahora: Date): Promise<void> {
  await descartarPropuesto(tx, id, ahora);
}

// ---------- Ejecuciones del motor (K7)

export interface NuevaEjecucion {
  fecha: string;
  inicioEn: Date;
  finEn: Date;
  duracionMs: number;
  resultado: "ok" | "error" | "tiempo_agotado";
  error: string | null;
  planId: string | null;
  versionMotor: string;
  usuarioId: string;
}

export async function insertarEjecucion(tx: Tx, e: NuevaEjecucion): Promise<string> {
  const [fila] = await tx.insert(ejecucionesMotor).values(e).returning({ id: ejecucionesMotor.id });
  return fila.id;
}

export async function ultimaEjecucion(
  bd: Conexion,
  fecha: string,
): Promise<{ duracionMs: number; resultado: "ok" | "error" | "tiempo_agotado"; en: Date } | null> {
  const [fila] = await bd
    .select({ duracionMs: ejecucionesMotor.duracionMs, resultado: ejecucionesMotor.resultado, en: ejecucionesMotor.inicioEn })
    .from(ejecucionesMotor)
    .where(eq(ejecucionesMotor.fecha, fecha))
    .orderBy(desc(ejecucionesMotor.inicioEn), desc(ejecucionesMotor.creadoEn))
    .limit(1);
  return fila ?? null;
}

// ---------- Rutas y paradas (solo al validar)

export interface NuevaParada {
  solicitudId: string;
  secuencia: number;
  ventanaInicio: string;
  ventanaFin: string;
  llegadaEstimada: Date;
  inicioEstimado: Date;
  finEstimado: Date;
  esperaMin: number;
  cargaKg: number;
  kmDesdeAnterior: number;
  kmContrafactual: number;
}

export interface NuevaRuta {
  jornadaId: string;
  numeroViaje: number;
  salidaEstimada: Date;
  regresoEstimado: Date;
  finDescargaEstimado: Date;
  cargaKg: number;
  kmEstimados: number;
  kmContrafactual: number;
  rendimientoKmLUsado: number;
  disponibleParaSalirEn: Date;
  asignadaEn: Date;
  paradas: NuevaParada[];
}

/** Inserta las rutas del plan con sus paradas vigentes. El índice único de paradas vigentes detiene a una validación simultánea. */
export async function insertarRutas(tx: Tx, planId: string, nuevas: NuevaRuta[], ahora: Date): Promise<void> {
  for (const r of nuevas) {
    const { paradas: suyas, ...ruta } = r;
    const [fila] = await tx
      .insert(rutas)
      .values({ ...ruta, planId, creadoEn: ahora, actualizadoEn: ahora })
      .returning({ id: rutas.id });
    if (suyas.length > 0) {
      await tx.insert(paradas).values(suyas.map((p) => ({ ...p, rutaId: fila.id, vigente: true, creadoEn: ahora, actualizadoEn: ahora })));
    }
  }
}

/** Ids, de entre los dados, de las solicitudes que ya tienen una parada vigente. */
export async function conParadaVigente(bd: Conexion, solicitudIds: string[]): Promise<string[]> {
  if (solicitudIds.length === 0) return [];
  const filas = await bd
    .select({ id: paradas.solicitudId })
    .from(paradas)
    .where(and(inArray(paradas.solicitudId, solicitudIds), eq(paradas.vigente, true)));
  return filas.map((f) => f.id);
}

export async function jornadaTieneRutas(bd: Conexion, jornadaId: string): Promise<boolean> {
  const [fila] = await bd.select({ id: rutas.id }).from(rutas).where(eq(rutas.jornadaId, jornadaId)).limit(1);
  return fila !== undefined;
}

// ---------- Solicitudes al validar

export interface SolicitudBloqueada { id: string; version: number; estado: string; proximaFechaElegible: string }

/** Bloquea (FOR UPDATE, en orden de id) las solicitudes que se van a escribir. */
export async function bloquearSolicitudes(tx: Tx, ids: string[]): Promise<SolicitudBloqueada[]> {
  if (ids.length === 0) return [];
  return tx
    .select({ id: solicitudes.id, version: solicitudes.version, estado: solicitudes.estado, proximaFechaElegible: solicitudes.proximaFechaElegible })
    .from(solicitudes)
    .where(inArray(solicitudes.id, ids))
    .orderBy(asc(solicitudes.id))
    .for("update");
}

/** Retira paradas vigentes (re-ruteo): reasignada si la solicitud queda ruteada en el plan nuevo, omitida si se pospone. */
export async function retirarParadas(tx: Tx, paradaIds: string[], estado: "reasignada" | "omitida", ahora: Date): Promise<void> {
  if (paradaIds.length === 0) return;
  await tx.update(paradas).set({ vigente: false, estado, actualizadoEn: ahora }).where(and(inArray(paradas.id, paradaIds), eq(paradas.vigente, true)));
}

/** Sube la versión estructural de las rutas que perdieron paradas: un teléfono con la versión vieja recibe ruta_cambiada. */
export async function subirVersionRutas(tx: Tx, rutaIds: string[], ahora: Date): Promise<void> {
  if (rutaIds.length === 0) return;
  await tx.update(rutas).set({ version: sql`${rutas.version} + 1`, actualizadoEn: ahora }).where(inArray(rutas.id, rutaIds));
}

/** Re-ruteo: las ruteadas pasan a programada desde pendiente, programada o en ruta. */
export async function reprogramarSolicitudes(tx: Tx, ids: string[], ahora: Date): Promise<void> {
  if (ids.length === 0) return;
  await tx
    .update(solicitudes)
    .set({ estado: "programada", actualizadoEn: ahora, version: sql`${solicitudes.version} + 1` })
    .where(and(inArray(solicitudes.id, ids), inArray(solicitudes.estado, ["pendiente", "programada", "en_ruta"])));
}

/** Re-ruteo: las pospuestas vuelven a pendiente para el siguiente día de operación, con su registro original. */
export async function posponerAsignadas(tx: Tx, ids: string[], proximaFechaElegible: string, ahora: Date): Promise<void> {
  if (ids.length === 0) return;
  await tx
    .update(solicitudes)
    .set({
      estado: "pendiente", proximaFechaElegible, vecesPospuesta: sql`${solicitudes.vecesPospuesta} + 1`,
      actualizadoEn: ahora, version: sql`${solicitudes.version} + 1`,
    })
    .where(and(inArray(solicitudes.id, ids), inArray(solicitudes.estado, ["pendiente", "programada", "en_ruta"])));
}

export async function programarSolicitudes(tx: Tx, ids: string[], ahora: Date): Promise<void> {
  if (ids.length === 0) return;
  await tx
    .update(solicitudes)
    .set({ estado: "programada", actualizadoEn: ahora, version: sql`${solicitudes.version} + 1` })
    .where(and(inArray(solicitudes.id, ids), eq(solicitudes.estado, "pendiente")));
}

/** Pospone: próxima fecha elegible al siguiente día de operación y una posposición más; conserva registrada_en. */
export async function posponerSolicitudes(tx: Tx, ids: string[], proximaFechaElegible: string, ahora: Date): Promise<void> {
  if (ids.length === 0) return;
  await tx
    .update(solicitudes)
    .set({
      proximaFechaElegible,
      vecesPospuesta: sql`${solicitudes.vecesPospuesta} + 1`,
      actualizadoEn: ahora,
      version: sql`${solicitudes.version} + 1`,
    })
    .where(and(inArray(solicitudes.id, ids), eq(solicitudes.estado, "pendiente")));
}

/** Alias para quien arma una generación. */
export type NuevaPlan = NuevoPlan;
