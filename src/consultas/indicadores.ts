import "server-only";
import type { Resultado } from "@/acciones/tipos";
import { contextoDeLaPeticion } from "@/seguridad/sesion";
import { panel, type VistaPanel } from "./indicadores.nucleo";

export type * from "./indicadores.nucleo";

/** desde y hasta: "AAAA-MM-DD" (por omisión, hoy). */
export async function panelConsulta(desde?: string, hasta?: string): Promise<Resultado<VistaPanel>> {
  return panel(await contextoDeLaPeticion(), desde, hasta);
}
