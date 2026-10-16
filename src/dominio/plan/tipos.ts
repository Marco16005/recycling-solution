import type { UnidadGuardada } from "../flota/tipos";

/** ConfiguracionCompleta es compatible por estructura; el dominio no importa de datos. */
export interface ConfiguracionPlan {
  patioLat: number | null;
  patioLng: number | null;
  turnoInicio: string; // HH:MM
  turnoFin: string; // HH:MM
  velocidadKmh: number;
  factorCircuidad: number;
  descargaMin: number;
  cargaPorOmisionKg: number;
  diasOperacion: number[];
  diasParaAtrasada: number;
  versionAvisoPrivacidad: string;
  /** Plan 7: HH:MM. construirEntrada las copia a parametros.horasPico en minutos. */
  horasPico?: { inicio: string; fin: string; factor: number }[];
}

export type MotivoAproximado = "sin_configurar" | "sin_respuesta" | "respuesta_invalida" | "error_osrm" | "demasiados_puntos";
/** Con qué tiempos se planeó (Plan 7, §4.1). */
export interface InfoTraslados {
  fuente: "osrm" | "aproximado";
  /** null si fuente = "osrm". */
  motivo: MotivoAproximado | null;
  mapa: string | null;
  paresAproximados: number;
}

export interface JornadaParaPlan {
  jornadaId: string;
  disponibleDesde: string; // HH:MM o HH:MM:SS
  unidad: UnidadGuardada;
}

/** Versiones de todo lo que sustentó la propuesta; validar compara contra lo actual. */
export interface VersionesPlan {
  solicitudes: Record<string, number>;
  clientes: Record<string, number>;
  jornadas: Record<string, number>;
  unidades: Record<string, number>;
  operadores: Record<string, number>;
  configuracion: number;
  /** Ausente en planes anteriores al Plan 7. */
  traslados?: InfoTraslados;
}
