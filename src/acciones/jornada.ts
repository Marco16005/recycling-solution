"use server";

import { revalidatePath } from "next/cache";
import { contextoDeLaPeticion } from "@/seguridad/sesion";
import { asignarJornada, quitarJornada, type AsignacionEntrada } from "./jornada.nucleo";
import type { Resultado } from "./tipos";

export async function asignarJornadaAccion(entrada: AsignacionEntrada): Promise<Resultado<{ id: string }>> {
  const resultado = await asignarJornada(await contextoDeLaPeticion(), entrada);
  if (resultado.ok) revalidatePath("/despacho/jornada");
  return resultado;
}

export async function quitarJornadaAccion(id: string, versionEsperada: number): Promise<Resultado<null>> {
  const resultado = await quitarJornada(await contextoDeLaPeticion(), id, versionEsperada);
  if (resultado.ok) revalidatePath("/despacho/jornada");
  return resultado;
}
