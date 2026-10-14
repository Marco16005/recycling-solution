import type { Contexto, Resultado } from "./tipos";

/** entrada de asignarJornada. disponibleDesde: "HH:MM". */
export interface AsignacionEntrada { fecha: string; unidadId: string; operadorId: string; disponibleDesde: string; notas: string | null }

/**
 * Permiso jornada.gestionar. Revalida en la transacción que la unidad y el operador estén activos, disponibles en la fecha
 * y sin otra jornada ese día. Si no: invalido con campos.unidadId u operadorId y el motivo.
 */
export async function asignarJornada(ctx: Contexto, entrada: unknown): Promise<Resultado<{ id: string }>> {
  void ctx; void entrada;
  throw new Error("pendiente: Plan 2 T3 (Claude)");
}

/** Permiso jornada.gestionar. Versión distinta: conflicto. */
export async function quitarJornada(ctx: Contexto, id: unknown, versionEsperada: unknown): Promise<Resultado<null>> {
  void ctx; void id; void versionEsperada;
  throw new Error("pendiente: Plan 2 T3 (Claude)");
}
