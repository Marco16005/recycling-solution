import type { Contexto, Resultado } from "./tipos";

/**
 * Permiso solicitudes.registrar. entrada: SolicitudEntrada (solicitudSchema). Folio del día de registro (Ciudad de México);
 * proxima_fecha_elegible = fecha solicitada; captura_fin_en = ctx.ahora. Cliente inactivo o inexistente: invalido.
 */
export async function registrarSolicitud(ctx: Contexto, entrada: unknown): Promise<Resultado<{ id: string; folio: string }>> {
  void ctx; void entrada;
  throw new Error("pendiente: Plan 2 T3 (Claude)");
}

/** Permiso solicitudes.cancelar. motivo: texto de 3 a 300 caracteres. Solo pendientes; versión distinta: conflicto. */
export async function cancelarSolicitud(ctx: Contexto, id: unknown, versionEsperada: unknown, motivo: unknown): Promise<Resultado<null>> {
  void ctx; void id; void versionEsperada; void motivo;
  throw new Error("pendiente: Plan 2 T3 (Claude)");
}

/** Permiso solicitudes.registrar. Cambia fecha solicitada y próxima elegible; nunca registrada_en. Solo pendientes. */
export async function reprogramarSolicitud(ctx: Contexto, id: unknown, versionEsperada: unknown, fecha: unknown): Promise<Resultado<null>> {
  void ctx; void id; void versionEsperada; void fecha;
  throw new Error("pendiente: Plan 2 T3 (Claude)");
}
