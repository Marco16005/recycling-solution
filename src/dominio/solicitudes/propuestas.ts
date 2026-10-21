import type { Recurrencia } from "../clientes/tipos";

/** Plan CRM, §4.4: propuestas de recolección que el despachador confirma. Se implementa en PC-2. */

export interface Ritmo { dias: number; ultima: string; muestra: number }
export interface DecisionPropuesta { fecha: string; estado: "confirmada" | "descartada" | "pospuesta"; pospuestaHasta: string | null }
export interface CandidatoPropuesta {
  clienteId: string; activo: boolean; habilitadoEnFecha: boolean; tieneSolicitudAbierta: boolean;
  recurrencia: Recurrencia | null; ritmo: Ritmo | null; decisiones: DecisionPropuesta[];
}
export interface Propuesta { clienteId: string; motivos: ("recurrencia" | "ritmo")[]; fechaEsperada: string | null; ritmo: Ritmo | null }

/** Con 3 o más solicitudes atendidas en los últimos 180 días: mediana de días entre fechas consecutivas. */
export function ritmoAprendido(fechasAtendidas: string[], hoy: string): Ritmo | null {
  void fechasAtendidas; void hoy;
  throw new Error("pendiente: PC-2");
}

export function tocaRecurrencia(r: Recurrencia, fecha: string): boolean {
  void r; void fecha;
  throw new Error("pendiente: PC-2");
}

export function propuestasParaFecha(fecha: string, diasOperacion: number[], candidatos: CandidatoPropuesta[]): Propuesta[] {
  void fecha; void diasOperacion; void candidatos;
  throw new Error("pendiente: PC-2");
}
