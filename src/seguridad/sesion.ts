import "server-only";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import type { Contexto } from "@/acciones/tipos";
import { bdDeLaAplicacion } from "@/datos/conexion";
import { usuarios } from "@/datos/esquema";
import { authDeLaAplicacion } from "./auth";
import type { UsuarioSesion } from "./permisos";

export interface SesionActual {
  usuario: UsuarioSesion;
  /** Id de la sesión de Better Auth de esta petición. */
  sesionId: string;
  correo: string;
}

/** Sesión de la petición con su usuario según `usuarios`. null si no hay sesión o la identidad no está dada de alta. */
export async function sesionActual(): Promise<SesionActual | null> {
  // Primero las cabeceras: marcan la petición como dinámica antes de tocar la base (el build no se conecta).
  const cabeceras = await headers();
  const sesion = await authDeLaAplicacion().api.getSession({ headers: cabeceras });
  if (!sesion) return null;
  const [fila] = await bdDeLaAplicacion()
    .select()
    .from(usuarios)
    .where(eq(usuarios.authUserId, sesion.user.id))
    .limit(1);
  if (!fila) return null;
  return {
    usuario: { id: fila.id, nombre: fila.nombre, rol: fila.rol, activo: fila.activo, debeCambiarClave: fila.debeCambiarClave },
    sesionId: sesion.session.id,
    correo: sesion.user.email,
  };
}

/** Usuario de la sesión según `usuarios`. null si no hay sesión o la identidad no está dada de alta. */
export async function usuarioActual(): Promise<UsuarioSesion | null> {
  return (await sesionActual())?.usuario ?? null;
}

const contexto = (usuario: UsuarioSesion | null): Contexto => ({ bd: bdDeLaAplicacion(), usuario, ahora: new Date(), reloj: () => new Date() });

/** Contexto de las consultas y acciones de esta petición. */
export async function contextoDeLaPeticion(): Promise<Contexto> {
  return contexto(await usuarioActual());
}

/** Contexto y sesión de la petición, para las acciones que deben conservar la sesión actual y cerrar las demás. */
export async function contextoConSesion(): Promise<{ ctx: Contexto; sesionId: string | null }> {
  const actual = await sesionActual();
  return { ctx: contexto(actual?.usuario ?? null), sesionId: actual?.sesionId ?? null };
}
