import type { Contexto, Resultado } from "./tipos";

/**
 * Plan del día (Plan 4, §3.3 y §4). generar, iniciar la revisión, ajustar y descartar: permiso planes.generar;
 * validar: planes.validar. Los conflictos llevan su motivo (CodigoConflicto).
 */

/** Ejecuta el motor sobre una instantánea y guarda la propuesta; registra la ejecución aunque falle. */
export async function generarPlanDelDia(ctx: Contexto, fecha: unknown): Promise<Resultado<{ planId: string }>> {
  void ctx;
  void fecha;
  throw new Error("pendiente");
}

/** Fija revision_iniciada_en una sola vez (K6); no cambia la versión del plan. */
export async function iniciarRevision(ctx: Contexto, planId: unknown): Promise<Resultado<null>> {
  void ctx;
  void planId;
  throw new Error("pendiente");
}

/** ajuste: AjusteManual (src/motor). Con actualizarHora, el servidor calcula instanteMin. */
export async function ajustarPlanDelDia(ctx: Contexto, planId: unknown, versionEsperada: unknown, ajuste: unknown): Promise<Resultado<{ version: number }>> {
  void ctx;
  void planId;
  void versionEsperada;
  void ajuste;
  throw new Error("pendiente");
}

/** entrada: { requisitosConfirmados: true }. */
export async function validarPlanDelDia(
  ctx: Contexto,
  planId: unknown,
  versionEsperada: unknown,
  entrada: unknown,
): Promise<Resultado<{ programadas: number; pospuestas: number }>> {
  void ctx;
  void planId;
  void versionEsperada;
  void entrada;
  throw new Error("pendiente");
}

/** Las solicitudes no se tocan. */
export async function descartarPlan(ctx: Contexto, planId: unknown, versionEsperada: unknown): Promise<Resultado<null>> {
  void ctx;
  void planId;
  void versionEsperada;
  throw new Error("pendiente");
}
