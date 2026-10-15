"use server";

import { revalidatePath } from "next/cache";
import { contextoDeLaPeticion } from "@/seguridad/sesion";
import { ajustarPlanDelDia, descartarPlan, generarPlanDelDia, iniciarRevision, validarPlanDelDia } from "./plan.nucleo";
import type { Resultado } from "./tipos";

const PANTALLAS = ["/despacho/plan", "/despacho/solicitudes"];
const refrescar = () => PANTALLAS.forEach((ruta) => revalidatePath(ruta));

export async function generarPlanAccion(fecha: string): Promise<Resultado<{ planId: string }>> {
  const resultado = await generarPlanDelDia(await contextoDeLaPeticion(), fecha);
  if (resultado.ok) refrescar();
  return resultado;
}

export async function iniciarRevisionAccion(planId: string): Promise<Resultado<null>> {
  return iniciarRevision(await contextoDeLaPeticion(), planId);
}

/** ajuste: { tipo: "mover", solicitudId, unidadId, viaje, posicion } | { tipo: "posponer", solicitudId } | { tipo: "actualizarHora" }. */
export async function ajustarPlanAccion(planId: string, versionEsperada: number, ajuste: unknown): Promise<Resultado<{ version: number }>> {
  const resultado = await ajustarPlanDelDia(await contextoDeLaPeticion(), planId, versionEsperada, ajuste);
  if (resultado.ok) refrescar();
  return resultado;
}

export async function validarPlanAccion(
  planId: string,
  versionEsperada: number,
  entrada: { requisitosConfirmados: boolean },
): Promise<Resultado<{ programadas: number; pospuestas: number }>> {
  const resultado = await validarPlanDelDia(await contextoDeLaPeticion(), planId, versionEsperada, entrada);
  if (resultado.ok) refrescar();
  return resultado;
}

export async function descartarPlanAccion(planId: string, versionEsperada: number): Promise<Resultado<null>> {
  const resultado = await descartarPlan(await contextoDeLaPeticion(), planId, versionEsperada);
  if (resultado.ok) refrescar();
  return resultado;
}
