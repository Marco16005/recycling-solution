import "server-only";
import type { UsuarioSesion } from "@/seguridad/permisos";
import { usuarioActual } from "@/seguridad/sesion";

/** Usuario de la sesión para mostrarlo en pantalla. null si no hay sesión, no está dado de alta o está inactivo. */
export async function usuarioDeLaSesion(): Promise<UsuarioSesion | null> {
  const usuario = await usuarioActual();
  return usuario !== null && usuario.activo ? usuario : null;
}
