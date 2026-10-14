import type { Cliente, EstadoPrivacidad } from "./tipos";

export type Faltante = "ubicacion" | "ventana" | "tipo_residuo" | "tipos_unidad" | "aviso_privacidad";

/** true si el último movimiento es "aceptado" y corresponde a la versión vigente del aviso. */
export function avisoVigente(p: EstadoPrivacidad | null, versionVigente: string): boolean {
  return p !== null && p.accion === "aceptado" && p.versionAviso === versionVigente;
}

/** Regla de completitud de la especificación (§6): lo que le falta a la ficha, en orden fijo. */
export function faltantesDeCliente(c: Cliente, versionAviso: string): Faltante[] {
  const faltan: Faltante[] = [];
  if (c.lat === null || c.lng === null) faltan.push("ubicacion");
  if (c.ventanas.length === 0) faltan.push("ventana");
  if (c.tipoResiduo === null) faltan.push("tipo_residuo");
  if (c.tiposUnidadAdmitidos.length === 0) faltan.push("tipos_unidad");
  if (!avisoVigente(c.privacidad, versionAviso)) faltan.push("aviso_privacidad");
  return faltan;
}

export function estaCompleto(c: Cliente, versionAviso: string): boolean {
  return faltantesDeCliente(c, versionAviso).length === 0;
}

/** porcentaje de 0 a 100; 0 si no hay clientes activos. */
export interface ResumenK5 {
  activos: number;
  completos: number;
  porcentaje: number;
}

/** Indicador K5 sobre la lista recibida (la cartera completa, no una búsqueda). */
export function resumenK5(clientes: Cliente[], versionAviso: string): ResumenK5 {
  const activos = clientes.filter((c) => c.activo);
  const completos = activos.filter((c) => estaCompleto(c, versionAviso)).length;
  return {
    activos: activos.length,
    completos,
    porcentaje: activos.length === 0 ? 0 : (completos / activos.length) * 100,
  };
}
