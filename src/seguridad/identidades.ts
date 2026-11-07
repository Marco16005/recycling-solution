import { randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import type { BD, Tx } from "@/datos/bd";
import { registrarEvento } from "@/datos/bitacora";
import { account, operadores, session, user, usuarios } from "@/datos/esquema";
import type { Rol } from "./permisos";

/**
 * Único módulo que escribe en las tablas de Better Auth (especificación §10). No usa el adaptador de la librería,
 * que tiene su propia conexión: todo va en la transacción de quien llama, junto con `usuarios` y la bitácora.
 * Depende del formato de Better Auth 1.7.7 (credencial "credential" con hash de better-auth/crypto);
 * al actualizar la librería hay que repetir src/seguridad/auth.integracion.test.ts.
 */

/** operadorId: ficha de operador que se liga (solo rol operador); si falta, se crea una con el mismo nombre. */
export interface DatosIdentidad {
  correo: string;
  nombre: string;
  clave: string;
  rol: Rol;
  operadorId?: string | null;
}

/** Quién hace el cambio: un usuario de la aplicación, o null si es un script dentro del contenedor. */
export type Autor = string | null;

export const CLAVE_MINIMA = 10;
export const CLAVE_MAXIMA = 128;

export const correoNormalizado = (correo: string) => correo.trim().toLowerCase();

function validarClave(clave: string): void {
  if (clave.length < CLAVE_MINIMA || clave.length > CLAVE_MAXIMA) {
    throw new Error(`La contraseña debe tener entre ${CLAVE_MINIMA} y ${CLAVE_MAXIMA} caracteres`);
  }
}

const accion = (base: string, por: Autor) => (por === null ? `${base}_por_script` : base);

/**
 * Una contraseña que pone otra persona desde la aplicación (un administrador al dar de alta o restablecer) es temporal:
 * el usuario debe cambiarla al entrar. Las de los scripts (por = null) las pone el dueño del servidor y no obligan.
 */
const esTemporal = (por: Autor) => por !== null;

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
  let operadorId: string | null = null;
  if (datos.rol === "operador") {
    operadorId =
      datos.operadorId ??
      (await tx.insert(operadores).values({ nombre, creadoEn: ahora, actualizadoEn: ahora }).returning({ id: operadores.id }))[0].id;
  }
  const [fila] = await tx
    .insert(usuarios)
    .values({ authUserId, nombre, rol: datos.rol, operadorId, debeCambiarClave: esTemporal(por), creadoEn: ahora, actualizadoEn: ahora })
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

/**
 * Toda baja, reactivación o cambio de contraseña sube la generación del usuario. Una entrada que empezó antes del cambio
 * no logra conservar su sesión (ver auth-base.ts), aunque Better Auth haya verificado la contraseña anterior.
 */
const siguienteGeneracion = sql`${usuarios.generacion} + 1`;

async function authUserIdDe(tx: Tx, usuarioId: string): Promise<string | null> {
  const [fila] = await tx.select({ authUserId: usuarios.authUserId }).from(usuarios).where(eq(usuarios.id, usuarioId));
  return fila?.authUserId ?? null;
}

/** Borra todas las sesiones del usuario (por ejemplo, al cambiar su rol). */
export async function cerrarSesiones(tx: Tx, authUserId: string): Promise<void> {
  await tx.delete(session).where(eq(session.userId, authUserId));
}

/** Desactiva y borra todas sus sesiones. false si el usuario no existe. */
export async function desactivarUsuario(tx: Tx, usuarioId: string, por: Autor, ahora: Date): Promise<boolean> {
  const authUserId = await authUserIdDe(tx, usuarioId);
  if (authUserId === null) return false;
  await tx
    .update(usuarios)
    .set({ activo: false, generacion: siguienteGeneracion, actualizadoEn: ahora })
    .where(eq(usuarios.id, usuarioId));
  await tx.delete(session).where(eq(session.userId, authUserId));
  await registrarEvento(tx, { usuarioId: por, entidad: "usuario", entidadId: usuarioId, accion: accion("desactivar", por), campos: ["activo"] });
  return true;
}

/** Reactiva; las sesiones anteriores ya no existen y no se recrean. false si el usuario no existe. */
export async function reactivarUsuario(tx: Tx, usuarioId: string, por: Autor, ahora: Date): Promise<boolean> {
  const authUserId = await authUserIdDe(tx, usuarioId);
  if (authUserId === null) return false;
  await tx
    .update(usuarios)
    .set({ activo: true, generacion: siguienteGeneracion, actualizadoEn: ahora })
    .where(eq(usuarios.id, usuarioId));
  await registrarEvento(tx, { usuarioId: por, entidad: "usuario", entidadId: usuarioId, accion: accion("reactivar", por), campos: ["activo"] });
  return true;
}

/**
 * Otra persona cambia la contraseña del usuario: borra todas sus sesiones y, si fue desde la aplicación, lo obliga a
 * elegir una nueva al entrar. false si el usuario no existe.
 */
export async function restablecerClave(tx: Tx, usuarioId: string, claveNueva: string, por: Autor, ahora: Date): Promise<boolean> {
  validarClave(claveNueva);
  const authUserId = await authUserIdDe(tx, usuarioId);
  if (authUserId === null) return false;
  const hash = await hashPassword(claveNueva);
  await tx
    .update(account)
    .set({ password: hash, updatedAt: ahora })
    .where(and(eq(account.userId, authUserId), eq(account.providerId, "credential")));
  await tx
    .update(usuarios)
    .set({ generacion: siguienteGeneracion, debeCambiarClave: esTemporal(por), actualizadoEn: ahora })
    .where(eq(usuarios.id, usuarioId));
  await tx.delete(session).where(eq(session.userId, authUserId));
  await registrarEvento(tx, { usuarioId: por, entidad: "usuario", entidadId: usuarioId, accion: accion("restablecer_clave", por), campos: ["clave"] });
  return true;
}

export type CambioPropio = "cambiada" | "clave_incorrecta" | "sin_sesion";

/**
 * El usuario cambia su propia contraseña desde la sesión `sesionId`. Toma los candados en el mismo orden que
 * restablecer, dar de baja y cambiar el rol (usuarios y luego la credencial) para no bloquearse con ellos. Ya con el
 * candado vuelve a comprobar que siga activo y que la sesión siga viva: una baja o un restablecimiento que terminó
 * mientras esperaba la borró. Conserva esa sesión y borra las demás.
 */
export async function cambiarClavePropia(
  tx: Tx,
  usuarioId: string,
  datos: { actual: string; nueva: string; sesionId: string },
  ahora: Date,
): Promise<CambioPropio> {
  validarClave(datos.nueva);
  const [u] = await tx
    .select({ authUserId: usuarios.authUserId, activo: usuarios.activo })
    .from(usuarios)
    .where(eq(usuarios.id, usuarioId))
    .for("update");
  if (!u?.activo) return "sin_sesion";
  const [viva] = await tx
    .select({ id: session.id })
    .from(session)
    .where(and(eq(session.id, datos.sesionId), eq(session.userId, u.authUserId), gt(session.expiresAt, ahora)));
  if (!viva) return "sin_sesion";
  const [credencial] = await tx
    .select({ id: account.id, password: account.password })
    .from(account)
    .where(and(eq(account.userId, u.authUserId), eq(account.providerId, "credential")))
    .for("update");
  if (!credencial?.password || !(await verifyPassword({ hash: credencial.password, password: datos.actual }))) {
    return "clave_incorrecta";
  }
  await tx.update(account).set({ password: await hashPassword(datos.nueva), updatedAt: ahora }).where(eq(account.id, credencial.id));
  await tx
    .update(usuarios)
    .set({ generacion: siguienteGeneracion, debeCambiarClave: false, actualizadoEn: ahora })
    .where(eq(usuarios.id, usuarioId));
  await tx.delete(session).where(and(eq(session.userId, u.authUserId), ne(session.id, datos.sesionId)));
  await registrarEvento(tx, { usuarioId, entidad: "usuario", entidadId: usuarioId, accion: "cambiar_clave", campos: ["clave"] });
  return "cambiada";
}
