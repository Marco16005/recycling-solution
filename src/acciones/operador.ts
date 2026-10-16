"use server";

import { revalidatePath } from "next/cache";
import { contextoDeLaPeticion } from "@/seguridad/sesion";
import { registrarEventoOperador, reportarIncidente, type RespuestaEvento } from "./operador.nucleo";
import type { Resultado } from "./tipos";

/** evento: EventoEntrada (src/dominio/operacion). Idempotente por eventoId: el teléfono puede reintentarlo. */
export async function registrarEventoAccion(evento: unknown): Promise<Resultado<RespuestaEvento>> {
  const resultado = await registrarEventoOperador(await contextoDeLaPeticion(), evento);
  if (resultado.ok) revalidatePath("/operador");
  return resultado;
}

/** entrada: { eventoId, jornadaId, tipo, descripcion, paradaId? }. Idempotente por eventoId. */
export async function reportarIncidenteAccion(entrada: unknown): Promise<Resultado<{ id: string; repetido: boolean }>> {
  const resultado = await reportarIncidente(await contextoDeLaPeticion(), entrada);
  if (resultado.ok) revalidatePath("/operador");
  return resultado;
}
