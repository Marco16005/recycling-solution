import { avisoVigente } from "./completitud";
import { estadoEfectivo } from "./documentos";
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
  const motivos: MotivoBloqueo[] = [];
  const agregar = (codigo: CodigoBloqueo, detalle: string | null = null) => motivos.push({ codigo, detalle });
  if (!c.activo) agregar("inactivo");
  if (c.lat === null || c.lng === null) agregar("sin_ubicacion");
  if (c.tipoResiduo === null) agregar("residuo_no_definido");
  if (c.tipoResiduo === "RP") agregar("residuo_peligroso");
  for (const documento of c.documentos) {
    if (documento.obligatorio && estadoEfectivo(documento, fecha) !== "vigente") {
      agregar("documento_no_vigente", documento.nombre);
    }
  }
  if (!avisoVigente(c.privacidad, versionAviso)) agregar("sin_aviso_privacidad");
  if (!c.ventanas.some((v) => v.diaSemana === diaSemanaDeFecha(fecha))) agregar("sin_ventana_ese_dia");
  if (c.tiposUnidadAdmitidos.length === 0) agregar("sin_tipos_unidad");
  return motivos;
}

/** 0 = domingo … 6 = sábado, sin depender de la zona horaria del proceso. */
export function diaSemanaDeFecha(fecha: string): number {
  return new Date(`${fecha}T00:00:00Z`).getUTCDay();
}
