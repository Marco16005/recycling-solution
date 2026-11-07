import { z } from "zod";
import type { Tx } from "@/datos/bd";
import { registrarEvento } from "@/datos/bitacora";
import {
  adminsActivos, cambiarRolUsuario, leerUsuarioParaCambiar, operadorLibre, subirVersionUsuario, tomarCandadoDeAdministradores,
  type UsuarioConCorreo,
} from "@/datos/usuarios";
import { erroresPorCampo } from "@/dominio/clientes/esquemas";
import { claveAleatoria } from "@/seguridad/claves";
import { buscarPorCorreo, cerrarSesiones, crearIdentidad, desactivarUsuario, reactivarUsuario, restablecerClave } from "@/seguridad/identidades";
import { ROLES } from "@/seguridad/permisos";
import { permitir } from "./autorizacion";
import type { Contexto, Resultado } from "./tipos";
import { esDuplicado, idSchema, invalido, versionSchema, type Fallo } from "./validacion";

/**
 * Reglas comunes (permiso usuarios.gestionar): rol operador ⇔ operadorId obligatorio y sin otro usuario; correo único;
 * no se puede quitar el rol de admin ni desactivar al último admin activo, ni desactivarse o restablecerse a uno mismo.
 * Todo cambio va con su bitácora en una transacción.
 */

const rolYOperadorSchema = z.object({
  rol: z.enum(ROLES),
  operadorId: z.uuid().nullable(),
});
const usuarioSchema = rolYOperadorSchema.extend({
  correo: z.email("Correo no válido").trim().toLowerCase().max(160),
  nombre: z.string().trim().min(2, "Escribe el nombre").max(120),
});

/** Valida la ficha de operador según el rol. Devuelve el operadorId a guardar o el fallo. */
async function operadorParaRol(tx: Tx, rol: string, operadorId: string | null, usuarioId: string | null): Promise<string | null | Fallo> {
  if (rol !== "operador") return null;
  if (operadorId === null) return invalido({ operadorId: ["Elige la ficha del operador"] });
  if (!(await operadorLibre(tx, operadorId, usuarioId))) return invalido({ operadorId: ["Esa ficha no existe o ya tiene usuario"] });
  return operadorId;
}

export const MENSAJE_RESTABLECER_PROPIA = "Tu propia contraseña se cambia en «Mi contraseña»";

const esFallo = (x: unknown): x is Fallo => typeof x === "object" && x !== null && "ok" in x;

/** Usuario bloqueado para cambiarlo, con la versión esperada comprobada. */
async function usuarioEnVersion(tx: Tx, id: string, version: number): Promise<UsuarioConCorreo | Fallo> {
  const u = await leerUsuarioParaCambiar(tx, id);
  if (u === null) return { ok: false, error: "no_encontrado" };
  if (u.version !== version) return { ok: false, error: "conflicto" };
  return u;
}

function idYVersion(id: unknown, versionEsperada: unknown): { id: string; version: number } | Fallo {
  const valido = idSchema.safeParse(id);
  if (!valido.success) return { ok: false, error: "no_encontrado" };
  const version = versionSchema.safeParse(versionEsperada);
  if (!version.success) return invalido({ _: ["Falta la versión del usuario"] });
  return { id: valido.data, version: version.data };
}

/** entrada: { correo, nombre, rol, operadorId }. La clave temporal se muestra una sola vez. */
export async function crearUsuario(ctx: Contexto, entrada: unknown): Promise<Resultado<{ id: string; claveTemporal: string }>> {
  const permiso = permitir(ctx, "usuarios.gestionar");
  if (!permiso.ok) return permiso;
  const validado = usuarioSchema.safeParse(entrada);
  if (!validado.success) return invalido(erroresPorCampo(validado.error));
  const datos = validado.data;
  const claveTemporal = claveAleatoria();
  const correoRepetido = invalido({ correo: ["Ya hay una cuenta con ese correo"] });

  try {
    return await ctx.bd.transaction(async (tx): Promise<Resultado<{ id: string; claveTemporal: string }>> => {
      if (await buscarPorCorreo(tx, datos.correo)) return correoRepetido;
      const operadorId = await operadorParaRol(tx, datos.rol, datos.operadorId, null);
      if (esFallo(operadorId)) return operadorId;
      const { usuarioId } = await crearIdentidad(
        tx,
        { correo: datos.correo, nombre: datos.nombre, clave: claveTemporal, rol: datos.rol, operadorId },
        permiso.usuario.id,
        ctx.ahora,
      );
      return { ok: true, valor: { id: usuarioId, claveTemporal } };
    });
  } catch (error) {
    // Otra alta con el mismo correo ganó entre la búsqueda y la inserción; la transacción ya se revirtió.
    if (esDuplicado(error, "user_email_unique")) return correoRepetido;
    throw error;
  }
}

/** entrada: { rol, operadorId }. Sube la generación y cierra sus sesiones en la misma transacción. */
export async function cambiarRol(ctx: Contexto, id: unknown, versionEsperada: unknown, entrada: unknown): Promise<Resultado<{ version: number }>> {
  const permiso = permitir(ctx, "usuarios.gestionar");
  if (!permiso.ok) return permiso;
  const ids = idYVersion(id, versionEsperada);
  if ("ok" in ids) return ids;
  const validado = rolYOperadorSchema.safeParse(entrada);
  if (!validado.success) return invalido(erroresPorCampo(validado.error));
  if (ids.id === permiso.usuario.id) return invalido({ rol: ["No puedes cambiar tu propio rol"] });

  return ctx.bd.transaction(async (tx): Promise<Resultado<{ version: number }>> => {
    await tomarCandadoDeAdministradores(tx);
    const u = await usuarioEnVersion(tx, ids.id, ids.version);
    if ("ok" in u) return u;
    if (u.rol === "admin" && validado.data.rol !== "admin" && u.activo && (await adminsActivos(tx)).length <= 1) {
      return invalido({ rol: ["Debe quedar al menos un administrador activo"] });
    }
    const operadorId = await operadorParaRol(tx, validado.data.rol, validado.data.operadorId, u.id);
    if (esFallo(operadorId)) return operadorId;
    const version = await cambiarRolUsuario(tx, u, validado.data.rol, operadorId, ctx.ahora);
    await cerrarSesiones(tx, u.authUserId);
    await registrarEvento(tx, { usuarioId: permiso.usuario.id, entidad: "usuario", entidadId: u.id, accion: "cambiar_rol", campos: ["rol", "operadorId"] });
    return { ok: true, valor: { version } };
  });
}

export async function darDeBajaUsuario(ctx: Contexto, id: unknown, versionEsperada: unknown): Promise<Resultado<{ version: number }>> {
  const permiso = permitir(ctx, "usuarios.gestionar");
  if (!permiso.ok) return permiso;
  const ids = idYVersion(id, versionEsperada);
  if ("ok" in ids) return ids;
  if (ids.id === permiso.usuario.id) return invalido({ _: ["No puedes desactivar tu propia cuenta"] });

  return ctx.bd.transaction(async (tx): Promise<Resultado<{ version: number }>> => {
    await tomarCandadoDeAdministradores(tx);
    const u = await usuarioEnVersion(tx, ids.id, ids.version);
    if ("ok" in u) return u;
    if (u.rol === "admin" && u.activo && (await adminsActivos(tx)).length <= 1) {
      return invalido({ _: ["Debe quedar al menos un administrador activo"] });
    }
    await desactivarUsuario(tx, u.id, permiso.usuario.id, ctx.ahora);
    return { ok: true, valor: { version: await subirVersionUsuario(tx, u.id) } };
  });
}

export async function reactivarCuenta(ctx: Contexto, id: unknown, versionEsperada: unknown): Promise<Resultado<{ version: number }>> {
  const permiso = permitir(ctx, "usuarios.gestionar");
  if (!permiso.ok) return permiso;
  const ids = idYVersion(id, versionEsperada);
  if ("ok" in ids) return ids;

  return ctx.bd.transaction(async (tx): Promise<Resultado<{ version: number }>> => {
    const u = await usuarioEnVersion(tx, ids.id, ids.version);
    if ("ok" in u) return u;
    await reactivarUsuario(tx, u.id, permiso.usuario.id, ctx.ahora);
    return { ok: true, valor: { version: await subirVersionUsuario(tx, u.id) } };
  });
}

export async function restablecerClaveDeUsuario(ctx: Contexto, id: unknown, versionEsperada: unknown): Promise<Resultado<{ version: number; claveTemporal: string }>> {
  const permiso = permitir(ctx, "usuarios.gestionar");
  if (!permiso.ok) return permiso;
  const ids = idYVersion(id, versionEsperada);
  if ("ok" in ids) return ids;
  // Restablecer borra las sesiones del usuario: el administrador se quedaría fuera antes de ver la temporal.
  if (ids.id === permiso.usuario.id) return invalido({ _: [MENSAJE_RESTABLECER_PROPIA] });
  const claveTemporal = claveAleatoria();

  return ctx.bd.transaction(async (tx): Promise<Resultado<{ version: number; claveTemporal: string }>> => {
    const u = await usuarioEnVersion(tx, ids.id, ids.version);
    if ("ok" in u) return u;
    await restablecerClave(tx, u.id, claveTemporal, permiso.usuario.id, ctx.ahora);
    return { ok: true, valor: { version: await subirVersionUsuario(tx, u.id), claveTemporal } };
  });
}
