"use server";

import { revalidatePath } from "next/cache";
import { contextoDeLaPeticion } from "@/seguridad/sesion";
import { confirmarPropuestas, posponerPropuesta, descartarPropuesta } from "./propuestas.nucleo";

export async function confirmarPropuestasAccion(fecha: string, clienteIds: string[]) {
  const resultado = await confirmarPropuestas(await contextoDeLaPeticion(), fecha, clienteIds);
  if (resultado.ok) {
    revalidatePath("/despacho/solicitudes");
    revalidatePath("/despacho/clientes", "layout");
  }
  return resultado;
}

export async function posponerPropuestaAccion(fecha: string, clienteId: string, dias: number) {
  const resultado = await posponerPropuesta(await contextoDeLaPeticion(), fecha, clienteId, dias);
  if (resultado.ok) revalidatePath("/despacho/solicitudes");
  return resultado;
}

export async function descartarPropuestaAccion(fecha: string, clienteId: string, nota: string) {
  const resultado = await descartarPropuesta(await contextoDeLaPeticion(), fecha, clienteId, nota);
  if (resultado.ok) revalidatePath("/despacho/solicitudes");
  return resultado;
}
