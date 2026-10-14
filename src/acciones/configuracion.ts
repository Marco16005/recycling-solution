"use server";

import { revalidatePath } from "next/cache";
import { contextoDeLaPeticion } from "@/seguridad/sesion";
import { guardarConfiguracion } from "./configuracion.nucleo";
import type { Resultado } from "./tipos";

export async function guardarConfiguracionAccion(versionEsperada: number, entrada: unknown): Promise<Resultado<{ version: number }>> {
  const resultado = await guardarConfiguracion(await contextoDeLaPeticion(), versionEsperada, entrada);
  if (resultado.ok) revalidatePath("/admin/configuracion");
  return resultado;
}
