import "server-only";
import type { Resultado } from "@/acciones/tipos";
import { contextoDeLaPeticion } from "@/seguridad/sesion";
import { obtenerJornada, type VistaJornada } from "./jornada.nucleo";

export type * from "./jornada.nucleo";

/** fecha "AAAA-MM-DD" o undefined para hoy. */
export async function obtenerJornadaConsulta(fecha?: string): Promise<Resultado<VistaJornada>> {
  return obtenerJornada(await contextoDeLaPeticion(), fecha);
}
