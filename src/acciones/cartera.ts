"use server";

import { revalidatePath } from "next/cache";
import { contextoDeLaPeticion } from "@/seguridad/sesion";
import { agregarNota, ubicacionDesdeTexto } from "./cartera.nucleo";

export async function ubicacionDesdeTextoAccion(texto: string) {
  return ubicacionDesdeTexto(await contextoDeLaPeticion(), texto);
}

export async function agregarNotaAccion(clienteId: string, entrada: unknown) {
  const resultado = await agregarNota(await contextoDeLaPeticion(), clienteId, entrada);
  if (resultado.ok) revalidatePath(`/despacho/clientes/${clienteId}`);
  return resultado;
}
