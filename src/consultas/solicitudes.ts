import "server-only";
import type { Resultado } from "@/acciones/tipos";
import { contextoDeLaPeticion } from "@/seguridad/sesion";
import { colaDeSolicitudes, type VistaCola } from "./solicitudes.nucleo";

export type * from "./solicitudes.nucleo";

/** fecha "AAAA-MM-DD" o undefined para hoy. */
export async function colaDeSolicitudesConsulta(fecha?: string): Promise<Resultado<VistaCola>> {
  return colaDeSolicitudes(await contextoDeLaPeticion(), fecha);
}
