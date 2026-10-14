import type { MotivoBloqueo } from "../clientes/habilitacion";

export const CANALES = ["telefono", "whatsapp", "correo", "presencial", "otro"] as const;
export type Canal = (typeof CANALES)[number];

/** programada y en_ruta los agrega el Plan 4. */
export const ESTADOS_SOLICITUD = ["pendiente", "cancelada", "atendida", "no_atendida"] as const;
export type EstadoSolicitud = (typeof ESTADOS_SOLICITUD)[number];

/** Fechas "AAAA-MM-DD" (calendario de Ciudad de México). registradaEn es inmutable y es la llave FIFO. */
export interface Solicitud {
  folio: string;
  clienteId: string;
  registradaEn: Date;
  fechaSolicitada: string;
  proximaFechaElegible: string;
  canal: Canal;
  cargaEstimadaKg: number | null;
  notas: string | null;
  estado: EstadoSolicitud;
  motivoCancelacion: string | null;
  vecesPospuesta: number;
}

export type SolicitudGuardada = Solicitud & { id: string; version: number };

/** Alta rápida. capturaInicioEn: cuando el despachador abrió el alta (K2); el servidor pone el fin. */
export interface SolicitudEntrada {
  clienteId: string;
  fechaSolicitada: string;
  canal: Canal;
  cargaEstimadaKg: number | null;
  notas: string | null;
  capturaInicioEn: Date | null;
}

/** lista: se puede planear hoy. bloqueada: algo del cliente lo impide. futura: aún no es su fecha. cerrada: cancelada, atendida o no atendida. */
export type EstadoEnCola = "lista" | "bloqueada" | "futura" | "cerrada";

export interface ElementoCola {
  solicitud: SolicitudGuardada;
  estado: EstadoEnCola;
  motivos: MotivoBloqueo[];
  /** Días de operación desde la fecha solicitada hasta hoy, sin contar la fecha solicitada. */
  diasDeAtraso: number;
  atrasada: boolean;
}
