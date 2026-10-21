import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { BD, Tx } from "./bd";
import { avisosPrivacidad, configuracion } from "./esquema";

export interface Configuracion {
  versionAvisoPrivacidad: string;
}

/** La fila única de configuración. La crea la migración de datos iniciales; si falta, la base está mal migrada. */
export async function leerConfiguracion(bd: BD | Tx): Promise<Configuracion> {
  const [fila] = await bd
    .select({ versionAvisoPrivacidad: configuracion.versionAvisoPrivacidad })
    .from(configuracion)
    .where(eq(configuracion.id, 1));
  if (!fila) throw new Error("Falta la fila de configuración: ejecuta el servicio migrate");
  return fila;
}

/** Toda la configuración de operación; horas "HH:MM". */
export interface ConfiguracionCompleta {
  patioLat: number | null;
  patioLng: number | null;
  turnoInicio: string;
  turnoFin: string;
  velocidadKmh: number;
  factorCircuidad: number;
  descargaMin: number;
  cargaPorOmisionKg: number;
  diasOperacion: number[];
  diasParaAtrasada: number;
  versionAvisoPrivacidad: string;
  /** Línea base del método actual (DI) y de K2 cronometrada (Plan 6). */
  lineaBase: LineaBase;
  /** Plan 7: multiplica los tiempos de auto de OSRM. */
  factorCamion: number;
  /** Plan 7: franjas de hora pico en HH:MM. */
  horasPico: FranjaHoraPico[];
  /** Plan 7: minutos de atraso proyectado a partir de los cuales se avisa. */
  umbralAtrasoMin: number;
  version: number;
}

export interface FranjaHoraPico { inicio: string; fin: string; factor: number }

export interface LineaBase { esperaMin: number; trasladoMin: number; cicloMin: number; k2Seg?: number; k2Muestra?: number; k2Fecha?: string }

const hhmm = (hora: string) => hora.slice(0, 5);

/** Bloquea (FOR SHARE) la fila de configuración hasta el fin de la transacción: nadie la edita mientras se valida un plan. */
export async function bloquearConfiguracionCompartido(tx: Tx): Promise<void> {
  await tx.select({ id: configuracion.id }).from(configuracion).where(eq(configuracion.id, 1)).for("share");
}

export async function leerConfiguracionCompleta(bd: BD | Tx): Promise<ConfiguracionCompleta> {
  const [c] = await bd.select().from(configuracion).where(eq(configuracion.id, 1));
  if (!c) throw new Error("Falta la fila de configuración: ejecuta el servicio migrate");
  return {
    patioLat: c.patioLat,
    patioLng: c.patioLng,
    turnoInicio: hhmm(c.turnoInicio),
    turnoFin: hhmm(c.turnoFin),
    velocidadKmh: c.velocidadKmh,
    factorCircuidad: c.factorCircuidad,
    descargaMin: c.descargaMin,
    cargaPorOmisionKg: c.cargaPorOmisionKg,
    diasOperacion: c.diasOperacion,
    diasParaAtrasada: c.diasParaAtrasada,
    versionAvisoPrivacidad: c.versionAvisoPrivacidad,
    lineaBase: c.lineaBase as LineaBase,
    factorCamion: c.factorCamion,
    horasPico: c.horasPico as FranjaHoraPico[],
    umbralAtrasoMin: c.umbralAtrasoMin,
    version: c.version,
  };
}

/** Los campos del Plan 7 son opcionales hasta que el formulario de configuración los envíe (P7-8). */
export type CambiosConfiguracion = Omit<ConfiguracionCompleta, "versionAvisoPrivacidad" | "version" | "lineaBase" | "factorCamion" | "horasPico" | "umbralAtrasoMin">
  & { lineaBase?: LineaBase } & Partial<Pick<ConfiguracionCompleta, "factorCamion" | "horasPico" | "umbralAtrasoMin">>;

export async function actualizarConfiguracionSiVersion(tx: Tx, version: number, cambios: CambiosConfiguracion, ahora: Date): Promise<number | null> {
  const [fila] = await tx
    .update(configuracion)
    .set({ ...cambios, actualizadoEn: ahora, version: sql`${configuracion.version} + 1` })
    .where(and(eq(configuracion.id, 1), eq(configuracion.version, version)))
    .returning({ version: configuracion.version });
  return fila?.version ?? null;
}

/** Versiones del aviso con texto, de la más reciente a la más antigua. */
export async function leerAvisosPublicados(bd: BD | Tx) {
  return bd
    .select({ version: avisosPrivacidad.version, texto: avisosPrivacidad.texto, publicadoEn: avisosPrivacidad.publicadoEn })
    .from(avisosPrivacidad)
    .where(isNotNull(avisosPrivacidad.texto))
    .orderBy(desc(avisosPrivacidad.publicadoEn));
}
