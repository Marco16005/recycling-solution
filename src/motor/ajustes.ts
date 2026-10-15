/* eslint-disable @typescript-eslint/no-unused-vars -- Contratos pendientes de implementar en P1. */
import type { AjusteManual, EntradaPlan, Plan, ResultadoAjuste, ResultadoRecalculo } from "./tipos";

/** Recalcula las secuencias dadas con las reglas de admisión, sin reordenarlas. */
export function recalcularRuta(entrada: EntradaPlan, unidadId: string, viajes: string[][]): ResultadoRecalculo {
  throw new Error("pendiente");
}

/** Recalcula las rutas afectadas y el resumen completo; conserva la traza original. */
export function ajustarPlan(entrada: EntradaPlan, plan: Plan, ajuste: AjusteManual): ResultadoAjuste {
  throw new Error("pendiente");
}
