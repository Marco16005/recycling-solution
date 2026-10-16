"use server";

import { revalidatePath } from "next/cache";
import { contextoDeLaPeticion } from "@/seguridad/sesion";
import { conciliarEvento, resolverIncidente } from "./operacion.nucleo";
import { generarReruteo } from "./reruteo.nucleo";
import type { Resultado } from "./tipos";

const refrescar = () => ["/despacho/plan", "/despacho/solicitudes", "/operador"].forEach((ruta) => revalidatePath(ruta));

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
  entrada: { jornadasNoDisponibles: string[] },
): Promise<Resultado<{ planId: string }>> {
  const resultado = await generarReruteo(await contextoDeLaPeticion(), planBaseId, versionEsperada, entrada);
  if (resultado.ok) refrescar();
  return resultado;
}
