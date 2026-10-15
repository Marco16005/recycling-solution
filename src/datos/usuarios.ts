import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Rol } from "@/seguridad/permisos";
import type { BD, Tx } from "./bd";
import { operadores, user, usuarios } from "./esquema";

export interface UsuarioConCorreo {
  id: string;
  authUserId: string;
  nombre: string;
  correo: string;
  rol: Rol;
  activo: boolean;
  operadorId: string | null;
  version: number;
}

export async function leerUsuarios(bd: BD | Tx): Promise<UsuarioConCorreo[]> {
  return bd
    .select({
      id: usuarios.id,
      authUserId: usuarios.authUserId,
      nombre: usuarios.nombre,
      correo: user.email,
      rol: usuarios.rol,
      activo: usuarios.activo,
      operadorId: usuarios.operadorId,
      version: usuarios.version,
    })
    .from(usuarios)
    .innerJoin(user, eq(user.id, usuarios.authUserId))
    .orderBy(asc(usuarios.nombre), asc(usuarios.id));
}

/** Bloquea el renglón del usuario hasta el fin de la transacción. */
export async function leerUsuarioParaCambiar(tx: Tx, id: string): Promise<UsuarioConCorreo | null> {
  const [fila] = await tx
    .select({
      id: usuarios.id,
      authUserId: usuarios.authUserId,
      nombre: usuarios.nombre,
      correo: user.email,
      rol: usuarios.rol,
      activo: usuarios.activo,
      operadorId: usuarios.operadorId,
      version: usuarios.version,
    })
    .from(usuarios)
    .innerJoin(user, eq(user.id, usuarios.authUserId))
    .where(eq(usuarios.id, id))
    .for("update", { of: usuarios });
  return fila ?? null;
}

/** Llave del candado de Postgres que serializa los cambios que pueden dejar al sistema sin administradores. */
const CANDADO_ADMINISTRADORES = 727_004;

/**
 * Toma el candado de administradores hasta el fin de la transacción. Va antes de bloquear al usuario que se cambia:
 * si cada cambio bloqueara primero a su usuario y luego a los demás administradores, dos cambios simultáneos sobre
 * administradores distintos se bloquearían mutuamente.
 */
export async function tomarCandadoDeAdministradores(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${CANDADO_ADMINISTRADORES})`);
}

/** Administradores activos. Llamar con el candado de administradores tomado. */
export async function adminsActivos(tx: Tx): Promise<string[]> {
  const filas = await tx
    .select({ id: usuarios.id })
    .from(usuarios)
    .where(and(eq(usuarios.rol, "admin"), eq(usuarios.activo, true)));
  return filas.map((f) => f.id);
}

/** Cambia rol y ficha de operador y sube versión y generación. Las sesiones las cierra identidades.cerrarSesiones. */
export async function cambiarRolUsuario(tx: Tx, u: UsuarioConCorreo, rol: Rol, operadorId: string | null, ahora: Date): Promise<number> {
  const [fila] = await tx
    .update(usuarios)
    .set({ rol, operadorId, actualizadoEn: ahora, version: sql`${usuarios.version} + 1`, generacion: sql`${usuarios.generacion} + 1` })
    .where(eq(usuarios.id, u.id))
    .returning({ version: usuarios.version });
  return fila.version;
}

/** Sube la versión del usuario (las funciones de identidades ya subieron la generación y cerraron sesiones). */
export async function subirVersionUsuario(tx: Tx, id: string): Promise<number> {
  const [fila] = await tx
    .update(usuarios)
    .set({ version: sql`${usuarios.version} + 1` })
    .where(eq(usuarios.id, id))
    .returning({ version: usuarios.version });
  return fila.version;
}

/** Fichas de operador activas sin usuario ligado. */
export async function operadoresSinUsuario(bd: BD | Tx): Promise<{ id: string; nombre: string; activo: boolean }[]> {
  return bd
    .select({ id: operadores.id, nombre: operadores.nombre, activo: operadores.activo })
    .from(operadores)
    .leftJoin(usuarios, eq(usuarios.operadorId, operadores.id))
    .where(and(isNull(usuarios.id), eq(operadores.activo, true)))
    .orderBy(asc(operadores.nombre));
}

/** true si la ficha de operador existe y no la usa otro usuario (sin contar a excluirUsuarioId). */
export async function operadorLibre(tx: Tx, operadorId: string, excluirUsuarioId: string | null): Promise<boolean> {
  const [op] = await tx.select({ id: operadores.id }).from(operadores).where(eq(operadores.id, operadorId)).for("update");
  if (!op) return false;
  const [ocupado] = await tx.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.operadorId, operadorId));
  return !ocupado || ocupado.id === excluirUsuarioId;
}
