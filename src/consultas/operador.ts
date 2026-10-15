import "server-only";
import type { Resultado } from "@/acciones/tipos";
import { contextoDeLaPeticion } from "@/seguridad/sesion";
import { miRuta, type VistaMiRuta } from "./operador.nucleo";

export type * from "./operador.nucleo";

/** Sin jornadaId: la jornada de hoy del operador de la sesión. */
export async function miRutaConsulta(jornadaId?: string): Promise<Resultado<VistaMiRuta>> {
  return miRuta(await contextoDeLaPeticion(), jornadaId);
}
