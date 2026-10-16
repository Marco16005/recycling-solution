import "server-only";
import type { Resultado } from "@/acciones/tipos";
import { contextoDeLaPeticion } from "@/seguridad/sesion";
import { obtenerPlan, type VistaPlan } from "./plan.nucleo";

export type * from "./plan.nucleo";

/** fecha "AAAA-MM-DD" o undefined para hoy. planId: un plan de esa fecha (por ejemplo, la propuesta de re-ruteo). */
export async function obtenerPlanConsulta(fecha?: string, planId?: string): Promise<Resultado<VistaPlan>> {
  return obtenerPlan(await contextoDeLaPeticion(), fecha, planId);
}
