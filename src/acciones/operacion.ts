"use server";

import { revalidatePath } from "next/cache";
import { contextoDeLaPeticion } from "@/seguridad/sesion";
import { conciliarEvento, resolverIncidente } from "./operacion.nucleo";
import { registrarEventoPorDespacho, type RespuestaEvento } from "./operador.nucleo";
import { generarReruteo } from "./reruteo.nucleo";
import type { Resultado } from "./tipos";

const refrescar = () => ["/despacho/plan", "/despacho/solicitudes", "/operador"].forEach((ruta) => revalidatePath(ruta));

/**
 * Tablero del día (diseño del 2026-11-21): el despacho marca el avance por el operador. evento: EventoEntrada, con un
 * eventoId nuevo por cada marca (idempotente si se reintenta). Rechazo: invalido con el motivo, sin guardar nada.
 */
export async function registrarEventoPorDespachoAccion(evento: unknown): Promise<Resultado<RespuestaEvento>> {
  const resultado = await registrarEventoPorDespacho(await contextoDeLaPeticion(), evento);
  if (resultado.ok) refrescar();
  return resultado;
}

export async function conciliarEventoAccion(eventoId: string, entrada: { nota: string }): Promise<Resultado<null>> {
  const resultado = await conciliarEvento(await contextoDeLaPeticion(), eventoId, entrada);
  if (resultado.ok) refrescar();
  return resultado;
}

export async function resolverIncidenteAccion(id: string, versionEsperada: number, entrada: { accion: string }): Promise<Resultado<{ version: number }>> {
  const resultado = await resolverIncidente(await contextoDeLaPeticion(), id, versionEsperada, entrada);
  if (resultado.ok) refrescar();
  return resultado;
}

/** Propuesta de re-ruteo sobre el plan validado de hoy; se revisa y se valida con validarPlanAccion. */
export async function generarReruteoAccion(
  planBaseId: string,
  versionEsperada: number,
  entrada: { jornadasNoDisponibles: string[]; liberadas?: string[] },
): Promise<Resultado<{ planId: string }>> {
  const resultado = await generarReruteo(await contextoDeLaPeticion(), planBaseId, versionEsperada, entrada);
  if (resultado.ok) refrescar();
  return resultado;
}
