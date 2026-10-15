/** Contratos de operación del Plan 5, §3.1. Horas ISO de la jornada. */
export type TipoEvento = "check_in" | "salida_patio" | "llegada" | "inicio_servicio" | "fin_servicio"
  | "no_atendida" | "regreso_patio" | "fin_descarga" | "check_out";
export type EstadoParada = "pendiente" | "en_sitio" | "en_servicio" | "completada" | "no_atendida"
  | "reasignada" | "omitida";

/** Las horas estimadas son las del plan con que se validó la ruta. */
export interface ParadaOperacion {
  paradaId: string; solicitudId: string; secuencia: number; estado: EstadoParada; vigente: boolean;
  llegadaEstimada: string; inicioEstimado: string; finEstimado: string;
  llegadaEn: string | null; inicioServicioEn: string | null; cierreEn: string | null;
}

export interface ViajeOperacion {
  rutaId: string; version: number;
  salidaEstimada: string; regresoEstimado: string; finDescargaEstimado: string;
  salidaPatioEn: string | null; regresoPatioEn: string | null; descargaFinEn: string | null;
  odometroInicioKm: number | null;
  paradas: ParadaOperacion[]; // En secuencia.
}

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
