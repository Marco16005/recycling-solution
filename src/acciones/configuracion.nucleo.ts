import type { Contexto, Resultado } from "./tipos";

/** Permiso configuracion.editar. entrada: ConfiguracionVista sin version, versionAvisoPrivacidad ni estiloMapaUrl. */
export async function guardarConfiguracion(ctx: Contexto, versionEsperada: unknown, entrada: unknown): Promise<Resultado<{ version: number }>> {
  void ctx; void versionEsperada; void entrada;
  throw new Error("pendiente: Plan 2 T3 (Claude)");
}
