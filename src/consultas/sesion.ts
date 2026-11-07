import "server-only";
import { redirect } from "next/navigation";
import type { UsuarioSesion } from "@/seguridad/permisos";
import { sesionActual, usuarioActual } from "@/seguridad/sesion";

/** Pantalla donde se cambia la contraseña propia; también a donde va quien entró con una temporal. */
export const RUTA_MI_CONTRASENA = "/cuenta/contrasena";

/**
 * Usuario de la sesión para mostrarlo en pantalla. null si no hay sesión, no está dado de alta o está inactivo.
 * Si entró con una contraseña temporal, lleva a cambiarla: lo usan todos los layouts y la página de inicio, así que
 * ninguna pantalla se muestra antes del cambio (las acciones y consultas ya lo niegan en `puede`).
 */
export async function usuarioDeLaSesion(): Promise<UsuarioSesion | null> {
  const usuario = await usuarioActual();
  if (usuario === null || !usuario.activo) return null;
  if (usuario.debeCambiarClave === true) redirect(RUTA_MI_CONTRASENA);
  return usuario;
}

export interface CuentaDeLaSesion {
  nombre: string;
  correo: string;
  rol: UsuarioSesion["rol"];
  usuarioId: string;
  debeCambiarClave: boolean;
}

/** Para la pantalla "Mi contraseña": no redirige aunque la contraseña sea temporal. null sin sesión o inactivo. */
export async function cuentaDeLaSesion(): Promise<CuentaDeLaSesion | null> {
  const actual = await sesionActual();
  if (actual === null || !actual.usuario.activo) return null;
  const { usuario } = actual;
  return { nombre: usuario.nombre, correo: actual.correo, rol: usuario.rol, usuarioId: usuario.id, debeCambiarClave: usuario.debeCambiarClave === true };
}
