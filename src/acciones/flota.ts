"use server";

import { revalidatePath } from "next/cache";
import type { OperadorEntrada, UnidadEntrada } from "@/dominio/flota/tipos";
import { contextoDeLaPeticion } from "@/seguridad/sesion";
import { guardarOperador, guardarUnidad, registrarEntregaAviso } from "./flota.nucleo";
import type { Resultado } from "./tipos";

export async function guardarUnidadAccion(id: string | null, versionEsperada: number | null, entrada: UnidadEntrada): Promise<Resultado<{ id: string; version: number }>> {
  const resultado = await guardarUnidad(await contextoDeLaPeticion(), id, versionEsperada, entrada);
  if (resultado.ok) revalidatePath("/despacho");
  return resultado;
}

export async function guardarOperadorAccion(id: string | null, versionEsperada: number | null, entrada: OperadorEntrada): Promise<Resultado<{ id: string; version: number }>> {
  const resultado = await guardarOperador(await contextoDeLaPeticion(), id, versionEsperada, entrada);
  if (resultado.ok) revalidatePath("/despacho");
  return resultado;
}

export async function registrarEntregaAvisoAccion(operadorId: string, versionEsperada: number): Promise<Resultado<{ version: number }>> {
  const resultado = await registrarEntregaAviso(await contextoDeLaPeticion(), operadorId, versionEsperada);
  if (resultado.ok) revalidatePath("/despacho");
  return resultado;
}
