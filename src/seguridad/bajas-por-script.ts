import type { Tx } from "@/datos/bd";
import { adminsActivos, leerUsuarioParaCambiar, subirVersionUsuario, tomarCandadoDeAdministradores } from "@/datos/usuarios";
import { desactivarUsuario, reactivarUsuario } from "./identidades";

/**
 * Baja o reactivación desde la terminal (scripts/desactivar-usuario.mts) con el mismo protocolo que la web
 * (acciones/usuarios.nucleo.ts): primero el candado de administradores, luego el usuario bloqueado, y nunca se desactiva
 * al último administrador activo. Sube la versión para que una pantalla abierta con la anterior reciba conflicto.
 */
export async function cambiarActivoPorScript(
  tx: Tx,
  usuarioId: string,
  activo: boolean,
  ahora: Date,
): Promise<"hecho" | "ultimo_admin" | "no_encontrado"> {
  await tomarCandadoDeAdministradores(tx);
  const u = await leerUsuarioParaCambiar(tx, usuarioId);
  if (u === null) return "no_encontrado";
  if (!activo && u.rol === "admin" && u.activo && (await adminsActivos(tx)).length <= 1) return "ultimo_admin";
  if (activo) await reactivarUsuario(tx, u.id, null, ahora);
  else await desactivarUsuario(tx, u.id, null, ahora);
  await subirVersionUsuario(tx, u.id);
  return "hecho";
}
