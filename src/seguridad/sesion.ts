import "server-only";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import type { Contexto } from "@/acciones/tipos";
import { bdDeLaAplicacion } from "@/datos/conexion";
import { usuarios } from "@/datos/esquema";
import { authDeLaAplicacion } from "./auth";
import type { UsuarioSesion } from "./permisos";

/** Usuario de la sesión según `usuarios`. null si no hay sesión o la identidad no está dada de alta. */
export async function usuarioActual(): Promise<UsuarioSesion | null> {
  // Primero las cabeceras: marcan la petición como dinámica antes de tocar la base (el build no se conecta).
  const cabeceras = await headers();
  const sesion = await authDeLaAplicacion().api.getSession({ headers: cabeceras });
  if (!sesion) return null;
  const [fila] = await bdDeLaAplicacion()
    .select()
    .from(usuarios)
    .where(eq(usuarios.authUserId, sesion.user.id))
    .limit(1);
  return fila ? { id: fila.id, nombre: fila.nombre, rol: fila.rol, activo: fila.activo } : null;
}

/** Contexto de las consultas y acciones de esta petición. */
export async function contextoDeLaPeticion(): Promise<Contexto> {
  const usuario = await usuarioActual();
  return { bd: bdDeLaAplicacion(), usuario, ahora: new Date() };
}
