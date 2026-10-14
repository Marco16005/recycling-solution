import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import type { BD, Tx } from "@/datos/bd";
import { registrarEvento } from "@/datos/bitacora";
import { account, session, user, usuarios } from "@/datos/esquema";
import type { Rol } from "./permisos";

/**
 * Único módulo que escribe en las tablas de Better Auth (especificación §10). No usa el adaptador de la librería,
 * que tiene su propia conexión: todo va en la transacción de quien llama, junto con `usuarios` y la bitácora.
 * Depende del formato de Better Auth 1.7.7 (credencial "credential" con hash de better-auth/crypto);
 * al actualizar la librería hay que repetir src/seguridad/auth.integracion.test.ts.
 */

export interface DatosIdentidad {
  correo: string;
  nombre: string;
  clave: string;
  rol: Rol;
}

/** Quién hace el cambio: un usuario de la aplicación, o null si es un script dentro del contenedor. */
export type Autor = string | null;

const CLAVE_MINIMA = 10;
const CLAVE_MAXIMA = 128;

export const correoNormalizado = (correo: string) => correo.trim().toLowerCase();

function validarClave(clave: string): void {
  if (clave.length < CLAVE_MINIMA || clave.length > CLAVE_MAXIMA) {
    throw new Error(`La contraseña debe tener entre ${CLAVE_MINIMA} y ${CLAVE_MAXIMA} caracteres`);
  }
}

const accion = (base: string, por: Autor) => (por === null ? `${base}_por_script` : base);

export interface IdentidadExistente {
  authUserId: string;
  usuarioId: string | null;
  rol: Rol | null;
  activo: boolean | null;
}

export async function buscarPorCorreo(bd: BD | Tx, correo: string): Promise<IdentidadExistente | null> {
  const [fila] = await bd
    .select({ authUserId: user.id, usuarioId: usuarios.id, rol: usuarios.rol, activo: usuarios.activo })
    .from(user)
    .leftJoin(usuarios, eq(usuarios.authUserId, user.id))
    .where(eq(user.email, correoNormalizado(correo)));
  return fila ?? null;
}

/** Crea identidad, credencial, usuario de la aplicación y su bitácora. */
export async function crearIdentidad(tx: Tx, datos: DatosIdentidad, por: Autor, ahora: Date): Promise<{ usuarioId: string }> {
  const nombre = datos.nombre.trim();
  if (nombre === "") throw new Error("Falta el nombre");
  validarClave(datos.clave);
  const authUserId = randomUUID();
  const hash = await hashPassword(datos.clave);

  await tx.insert(user).values({
    id: authUserId,
    name: nombre,
    email: correoNormalizado(datos.correo),
    emailVerified: true,
    createdAt: ahora,
    updatedAt: ahora,
  });
  await tx.insert(account).values({
    id: randomUUID(),
    accountId: authUserId,
    providerId: "credential",
    userId: authUserId,
    password: hash,
    createdAt: ahora,
    updatedAt: ahora,
  });
  const [fila] = await tx
    .insert(usuarios)
    .values({ authUserId, nombre, rol: datos.rol, creadoEn: ahora, actualizadoEn: ahora })
    .returning({ id: usuarios.id });
  await registrarEvento(tx, {
    usuarioId: por,
    entidad: "usuario",
    entidadId: fila.id,
    accion: accion("crear", por),
    campos: ["correo", "nombre", "rol", "clave"],
  });
  return { usuarioId: fila.id };
}

async function authUserIdDe(tx: Tx, usuarioId: string): Promise<string | null> {
  const [fila] = await tx.select({ authUserId: usuarios.authUserId }).from(usuarios).where(eq(usuarios.id, usuarioId));
  return fila?.authUserId ?? null;
}

/** Desactiva y borra todas sus sesiones. false si el usuario no existe. */
export async function desactivarUsuario(tx: Tx, usuarioId: string, por: Autor, ahora: Date): Promise<boolean> {
  const authUserId = await authUserIdDe(tx, usuarioId);
  if (authUserId === null) return false;
  await tx.update(usuarios).set({ activo: false, actualizadoEn: ahora }).where(eq(usuarios.id, usuarioId));
  await tx.delete(session).where(eq(session.userId, authUserId));
  await registrarEvento(tx, { usuarioId: por, entidad: "usuario", entidadId: usuarioId, accion: accion("desactivar", por), campos: ["activo"] });
  return true;
}

/** Reactiva; las sesiones anteriores ya no existen y no se recrean. false si el usuario no existe. */
export async function reactivarUsuario(tx: Tx, usuarioId: string, por: Autor, ahora: Date): Promise<boolean> {
  const authUserId = await authUserIdDe(tx, usuarioId);
  if (authUserId === null) return false;
  await tx.update(usuarios).set({ activo: true, actualizadoEn: ahora }).where(eq(usuarios.id, usuarioId));
  await registrarEvento(tx, { usuarioId: por, entidad: "usuario", entidadId: usuarioId, accion: accion("reactivar", por), campos: ["activo"] });
  return true;
}

/** Cambia la contraseña y borra todas las sesiones del usuario. false si el usuario no existe. */
export async function restablecerClave(tx: Tx, usuarioId: string, claveNueva: string, por: Autor, ahora: Date): Promise<boolean> {
  validarClave(claveNueva);
  const authUserId = await authUserIdDe(tx, usuarioId);
  if (authUserId === null) return false;
  const hash = await hashPassword(claveNueva);
  await tx
    .update(account)
    .set({ password: hash, updatedAt: ahora })
    .where(and(eq(account.userId, authUserId), eq(account.providerId, "credential")));
  await tx.delete(session).where(eq(session.userId, authUserId));
  await registrarEvento(tx, { usuarioId: por, entidad: "usuario", entidadId: usuarioId, accion: accion("restablecer_clave", por), campos: ["clave"] });
  return true;
}
