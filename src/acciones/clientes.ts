"use server";

import { revalidatePath } from "next/cache";
import type { ClienteEntrada, PrivacidadEntrada } from "@/dominio/clientes/esquemas";
import type { EstadoPrivacidad } from "@/dominio/clientes/tipos";
import { contextoDeLaPeticion } from "@/seguridad/sesion";
import { guardarCliente, registrarPrivacidad } from "./clientes.nucleo";
import type { Resultado } from "./tipos";

export async function guardarClienteAccion(
  id: string | null,
  versionEsperada: number | null,
  entrada: ClienteEntrada,
): Promise<Resultado<{ id: string; version: number }>> {
  const resultado = await guardarCliente(await contextoDeLaPeticion(), id, versionEsperada, entrada);
  if (resultado.ok) revalidatePath("/despacho/clientes");
  return resultado;
}

export async function registrarPrivacidadAccion(
  clienteId: string,
  entrada: PrivacidadEntrada,
): Promise<Resultado<{ privacidad: EstadoPrivacidad }>> {
  const resultado = await registrarPrivacidad(await contextoDeLaPeticion(), clienteId, entrada);
  if (resultado.ok) revalidatePath("/despacho/clientes");
  return resultado;
}
