import type { Contexto, Resultado } from "./tipos";

/**
 * Crea (id y versionEsperada null) o actualiza una unidad con sus documentos. Permiso flota.editar.
 * entrada: UnidadEntrada (unidadSchema). Placa o número económico repetidos: invalido con campos.placa o campos.numeroEconomico.
 */
export async function guardarUnidad(ctx: Contexto, id: unknown, versionEsperada: unknown, entrada: unknown): Promise<Resultado<{ id: string; version: number }>> {
  void ctx; void id; void versionEsperada; void entrada;
  throw new Error("pendiente: Plan 2 T3 (Claude)");
}

/** Igual que guardarUnidad. entrada: OperadorEntrada (operadorSchema). */
export async function guardarOperador(ctx: Contexto, id: unknown, versionEsperada: unknown, entrada: unknown): Promise<Resultado<{ id: string; version: number }>> {
  void ctx; void id; void versionEsperada; void entrada;
  throw new Error("pendiente: Plan 2 T3 (Claude)");
}

/** Registra que se entregó al operador la versión vigente del aviso de privacidad, con la fecha de hoy. Permiso flota.editar. */
export async function registrarEntregaAviso(ctx: Contexto, operadorId: unknown, versionEsperada: unknown): Promise<Resultado<{ version: number }>> {
  void ctx; void operadorId; void versionEsperada;
  throw new Error("pendiente: Plan 2 T3 (Claude)");
}
