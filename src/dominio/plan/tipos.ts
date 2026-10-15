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
}
