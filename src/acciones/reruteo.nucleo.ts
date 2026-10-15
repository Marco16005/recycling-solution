import type { Contexto, Resultado } from "./tipos";

/**
 * Re-ruteo (Plan 5, §4). Permiso planes.generar. entrada: { jornadasNoDisponibles: string[] }.
 * La validación es la rama propia de validarPlanDelDia para planes de tipo re_ruteo.
 */
export async function generarReruteo(ctx: Contexto, planBaseId: unknown, versionEsperada: unknown, entrada: unknown): Promise<Resultado<{ planId: string }>> {
  void ctx;
  void planBaseId;
  void versionEsperada;
  void entrada;
  throw new Error("pendiente");
}
