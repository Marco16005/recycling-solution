import { permitir } from "@/acciones/autorizacion";
import type { Contexto, Resultado } from "@/acciones/tipos";
import { leerUsuarios, operadoresSinUsuario } from "@/datos/usuarios";
import type { Rol } from "@/seguridad/permisos";
import type { OperadorResumen } from "./flota.nucleo";
import { leerInstantanea } from "./instantanea";

export interface FilaUsuario { id: string; nombre: string; correo: string; rol: Rol; activo: boolean; operadorId: string | null; version: number }
/** operadoresSinUsuario: fichas de operador activas que aún no tienen usuario (para ligarlas). */
export interface ListadoUsuarios { usuarios: FilaUsuario[]; operadoresSinUsuario: OperadorResumen[]; usuarioActualId: string }

/** Permiso usuarios.gestionar. */
export async function listarUsuarios(ctx: Contexto): Promise<Resultado<ListadoUsuarios>> {
  const permiso = permitir(ctx, "usuarios.gestionar");
  if (!permiso.ok) return permiso;
  const { usuarios, libres } = await leerInstantanea(ctx.bd, async (tx) => ({
    usuarios: await leerUsuarios(tx),
    libres: await operadoresSinUsuario(tx),
  }));
  return {
    ok: true,
    valor: {
      usuarios: usuarios.map((u) => ({
        id: u.id, nombre: u.nombre, correo: u.correo, rol: u.rol, activo: u.activo, operadorId: u.operadorId, version: u.version,
      })),
      operadoresSinUsuario: libres,
      usuarioActualId: permiso.usuario.id,
    },
  };
}
