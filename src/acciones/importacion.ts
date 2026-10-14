"use server";

import { revalidatePath } from "next/cache";
import { contextoDeLaPeticion } from "@/seguridad/sesion";
import { analizarImportacion, confirmarImportacion, type ResumenImportacion } from "./importacion.nucleo";
import type { Resultado } from "./tipos";

export async function analizarImportacionAccion(csv: string): Promise<Resultado<ResumenImportacion>> {
  return analizarImportacion(await contextoDeLaPeticion(), csv);
}

export async function confirmarImportacionAccion(
  csv: string,
  opciones: { operacionId: string; huella: string; aceptarDuplicados: boolean },
): Promise<Resultado<{ importados: number }>> {
  const resultado = await confirmarImportacion(await contextoDeLaPeticion(), csv, opciones);
  if (resultado.ok) revalidatePath("/despacho/clientes");
  return resultado;
}
