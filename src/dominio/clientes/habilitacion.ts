import type { Cliente } from "./tipos";

/** Espec. §7 regla 3, la parte que depende solo del cliente. El Plan 2 agrega la disponibilidad de unidades. */
export type CodigoBloqueo =
  | "inactivo"
  | "sin_ubicacion"
  | "residuo_no_definido"
  | "residuo_peligroso"
  | "documento_no_vigente"
  | "sin_aviso_privacidad"
  | "sin_ventana_ese_dia"
  | "sin_tipos_unidad";

/** detalle: dato que explica el motivo (p. ej. el nombre del documento); null si no aplica. */
export interface MotivoBloqueo {
  codigo: CodigoBloqueo;
  detalle: string | null;
}

/**
 * Motivos por los que no se puede programar una recolección del cliente en la fecha dada
 * ("AAAA-MM-DD", calendario de Ciudad de México). Lista vacía = habilitado. Orden estable: el de CodigoBloqueo.
 */
export function motivosDeBloqueoCliente(c: Cliente, fecha: string, versionAviso: string): MotivoBloqueo[] {
  void c;
  void fecha;
  void versionAviso;
  throw new Error("pendiente: T3 (Codex)");
}

/** 0 = domingo … 6 = sábado, sin depender de la zona horaria del proceso. */
export function diaSemanaDeFecha(fecha: string): number {
  void fecha;
  throw new Error("pendiente: T3 (Codex)");
}
