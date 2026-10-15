import "server-only";
import type { Resultado } from "@/acciones/tipos";
import { contextoDeLaPeticion } from "@/seguridad/sesion";
import { seguimiento, type VistaSeguimiento } from "./operacion.nucleo";

export type * from "./operacion.nucleo";

/** fecha "AAAA-MM-DD" o undefined para hoy. */
export async function seguimientoConsulta(fecha?: string): Promise<Resultado<VistaSeguimiento>> {
  return seguimiento(await contextoDeLaPeticion(), fecha);
}
