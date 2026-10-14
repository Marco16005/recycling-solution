import type { Contexto, Resultado } from "./tipos";

/**
 * Reglas comunes (permiso usuarios.gestionar): rol operador ⇔ operadorId obligatorio y sin otro usuario; correo único;
 * no se puede quitar el rol de admin ni desactivar al último admin activo, ni desactivarse a uno mismo.
 * Todo cambio va con su bitácora en una transacción.
 */

/** entrada: { correo, nombre, rol, operadorId }. La clave temporal se muestra una sola vez. */
export async function crearUsuario(ctx: Contexto, entrada: unknown): Promise<Resultado<{ id: string; claveTemporal: string }>> {
  void ctx; void entrada;
  throw new Error("pendiente: Plan 2 T3 (Claude)");
}

/** entrada: { rol, operadorId }. Sube la generación y cierra sus sesiones en la misma transacción. */
export async function cambiarRol(ctx: Contexto, id: unknown, versionEsperada: unknown, entrada: unknown): Promise<Resultado<{ version: number }>> {
  void ctx; void id; void versionEsperada; void entrada;
  throw new Error("pendiente: Plan 2 T3 (Claude)");
}

export async function darDeBajaUsuario(ctx: Contexto, id: unknown, versionEsperada: unknown): Promise<Resultado<{ version: number }>> {
  void ctx; void id; void versionEsperada;
  throw new Error("pendiente: Plan 2 T3 (Claude)");
}

export async function reactivarCuenta(ctx: Contexto, id: unknown, versionEsperada: unknown): Promise<Resultado<{ version: number }>> {
  void ctx; void id; void versionEsperada;
  throw new Error("pendiente: Plan 2 T3 (Claude)");
}

export async function restablecerClaveDeUsuario(ctx: Contexto, id: unknown, versionEsperada: unknown): Promise<Resultado<{ version: number; claveTemporal: string }>> {
  void ctx; void id; void versionEsperada;
  throw new Error("pendiente: Plan 2 T3 (Claude)");
}
