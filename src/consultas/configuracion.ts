import "server-only";
import type { Resultado } from "@/acciones/tipos";
import { contextoDeLaPeticion } from "@/seguridad/sesion";
import { obtenerConfiguracion, type ConfiguracionVista } from "./configuracion.nucleo";

export type * from "./configuracion.nucleo";

export async function obtenerConfiguracionConsulta(): Promise<Resultado<ConfiguracionVista>> {
  return obtenerConfiguracion(await contextoDeLaPeticion());
}
