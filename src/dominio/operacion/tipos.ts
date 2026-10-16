/** Contratos de operación del Plan 5, §3.1, y de proyección del Plan 7, §2.3. Horas ISO de la jornada. */
import type { FranjaPico } from "@/motor";
export type TipoEvento = "check_in" | "salida_patio" | "llegada" | "inicio_servicio" | "fin_servicio"
  | "no_atendida" | "regreso_patio" | "fin_descarga" | "check_out";
export type EstadoParada = "pendiente" | "en_sitio" | "en_servicio" | "completada" | "no_atendida"
  | "reasignada" | "omitida";

/** Las horas estimadas son las del plan con que se validó la ruta. */
export interface ParadaOperacion {
  paradaId: string; solicitudId: string; secuencia: number; estado: EstadoParada; vigente: boolean;
  llegadaEstimada: string; inicioEstimado: string; finEstimado: string;
  llegadaEn: string | null; inicioServicioEn: string | null; cierreEn: string | null;
  /** HH:MM (Plan 7). */
  ventanaInicio: string; ventanaFin: string;
}

export interface ViajeOperacion {
  rutaId: string; version: number;
  salidaEstimada: string; regresoEstimado: string; finDescargaEstimado: string;
  salidaPatioEn: string | null; regresoPatioEn: string | null; descargaFinEn: string | null;
  odometroInicioKm: number | null;
  paradas: ParadaOperacion[]; // En secuencia.
  /** Modelo de tiempos con que se planeó (Plan 7); null en rutas anteriores. */
  tiempos: TiemposRuta | null;
}

/** Modelo de tiempos con que se planeó una ruta (Plan 7, §2.6). */
export interface TiemposRuta {
  /** "patio" y los solicitudId de la ruta, en el orden del plan. */
  puntos: string[];
  /** Dirigida, entre esos puntos. */
  minLibres: number[][];
  /** Las del plan de origen; [] si no tenía. */
  horasPico: FranjaPico[];
  turnoFinMin: number;
  descargaMin: number;
}

export type TipoAlerta = "ventana_en_riesgo" | "fuera_de_turno" | "atraso";
export interface AlertaOperacion {
  tipo: TipoAlerta; rutaId: string;
  /** null en fuera_de_turno y en atraso de salida. */
  paradaId: string | null;
  /** Cuánto se pasa (entero, ≥ 1). */
  minutos: number;
  enViajeEnCurso: boolean;
}
export interface ParadaProyectada {
  paradaId: string; llegada: string; inicio: string; fin: string;
  /** La ubicación anterior se supuso (tras una no atendida sin llegada). */
  ubicacionSupuesta: boolean;
}
export interface ViajeProyectado {
  rutaId: string; salida: string; regreso: string; finDescarga: string;
  /** Ruta sin tiempos: estimaciones desplazadas por el retraso observado. */
  aproximada: boolean;
  /** Solo vigentes no cerradas. */
  paradas: ParadaProyectada[];
}
export interface ProyeccionJornada { jornadaId: string; viajes: ViajeProyectado[]; alertas: AlertaOperacion[] }
export interface OpcionesProyeccion { ahora: string; umbralAtrasoMin: number; turnoFinMin: number; descargaMin: number }

/** La acción arma el estado con todo bloqueado, sobre las rutas operativas de todos los planes. */
export interface EstadoJornada {
  jornadaId: string; fecha: string; checkInEn: string | null; checkOutEn: string | null;
  ultimoOcurridoEn: string | null; ultimoOdometroKm: number | null;
  viajes: ViajeOperacion[]; // Rutas iniciadas o con paradas vigentes, en secuencia operativa.
}

export interface EventoEntrada {
  eventoId: string; jornadaId: string; tipo: TipoEvento; ocurridoEn: string;
  rutaId: string | null; paradaId: string | null; versionRuta: number | null;
  odometroKm: number | null; motivo: string | null;
}

export type Efecto =
  | { tipo: "jornada"; campo: "check_in_en" | "check_out_en" }
  | { tipo: "ruta"; rutaId: string; campo: "salida_patio_en" | "regreso_patio_en" | "descarga_fin_en"; odometroKm?: number }
  | { tipo: "disponibilidad_siguiente"; rutaId: string }
  | { tipo: "parada"; paradaId: string; estado: EstadoParada;
      campos: ("llegada_en" | "inicio_servicio_en" | "fin_servicio_en" | "cierre_en")[]; motivo?: string; liberar?: boolean }
  | { tipo: "solicitudes"; rutaId: string; estado: "en_ruta" }
  | { tipo: "solicitud"; paradaId: string; estado: "atendida" | "pendiente_siguiente_dia" };
