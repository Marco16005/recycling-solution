import type { BD } from "@/datos/bd";
import type { UsuarioSesion } from "@/seguridad/permisos";

/** Lo que reciben las acciones y consultas: base, usuario de la sesión y el instante de la petición. */
export interface Contexto {
  bd: BD;
  usuario: UsuarioSesion | null;
  ahora: Date;
}

export type Resultado<T> =
  | { ok: true; valor: T }
  | { ok: false; error: "no_autenticado" | "no_autorizado" | "no_encontrado" | "conflicto" }
  | { ok: false; error: "invalido"; campos: Record<string, string[]> };
