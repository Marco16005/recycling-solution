import "server-only";
import type { Resultado } from "@/acciones/tipos";
import { contextoDeLaPeticion } from "@/seguridad/sesion";
import { obtenerPreparacion, type Preparacion } from "./preparacion.nucleo";

export type * from "./preparacion.nucleo";

/** Lista "Antes de generar" del plan del día. fecha "AAAA-MM-DD" o undefined para hoy. */
export async function obtenerPreparacionConsulta(fecha?: string): Promise<Resultado<Preparacion>> {
  return obtenerPreparacion(await contextoDeLaPeticion(), fecha);
}
