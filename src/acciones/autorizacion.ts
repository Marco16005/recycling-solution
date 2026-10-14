import { autorizar, NoAutorizado, type Permiso, type UsuarioSesion } from "@/seguridad/permisos";
import type { Contexto } from "./tipos";

export type Permitido = { ok: true; usuario: UsuarioSesion } | { ok: false; error: "no_autenticado" | "no_autorizado" };

/** Primer paso de toda acción y consulta: el usuario de la sesión, o el error que se devuelve tal cual. */
export function permitir(ctx: Contexto, permiso: Permiso): Permitido {
  try {
    return { ok: true, usuario: autorizar(ctx.usuario, permiso) };
  } catch (error) {
    return { ok: false, error: error instanceof NoAutorizado ? "no_autorizado" : "no_autenticado" };
  }
}
