"use server";

import { revalidatePath } from "next/cache";
import { buscarClientesParaSolicitud, type ClienteParaSolicitud } from "@/consultas/solicitudes.nucleo";
import type { SolicitudEntrada } from "@/dominio/solicitudes/tipos";
import { contextoDeLaPeticion } from "@/seguridad/sesion";
import { cancelarSolicitud, registrarSolicitud, reprogramarSolicitud } from "./solicitudes.nucleo";
import type { Resultado } from "./tipos";

export async function registrarSolicitudAccion(entrada: SolicitudEntrada): Promise<Resultado<{ id: string; folio: string }>> {
  const resultado = await registrarSolicitud(await contextoDeLaPeticion(), entrada);
  if (resultado.ok) revalidatePath("/despacho/solicitudes");
  return resultado;
}

export async function cancelarSolicitudAccion(id: string, versionEsperada: number, motivo: string): Promise<Resultado<null>> {
  const resultado = await cancelarSolicitud(await contextoDeLaPeticion(), id, versionEsperada, motivo);
  if (resultado.ok) revalidatePath("/despacho/solicitudes");
  return resultado;
}

export async function reprogramarSolicitudAccion(id: string, versionEsperada: number, fecha: string): Promise<Resultado<null>> {
  const resultado = await reprogramarSolicitud(await contextoDeLaPeticion(), id, versionEsperada, fecha);
  if (resultado.ok) revalidatePath("/despacho/solicitudes");
  return resultado;
}

/** Buscador del alta rápida (se llama al teclear, desde el navegador). */
export async function buscarClientesParaSolicitudAccion(texto: string): Promise<Resultado<ClienteParaSolicitud[]>> {
  return buscarClientesParaSolicitud(await contextoDeLaPeticion(), texto);
}
