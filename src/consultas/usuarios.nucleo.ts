import type { Contexto, Resultado } from "@/acciones/tipos";
import type { Rol } from "@/seguridad/permisos";
import type { OperadorResumen } from "./flota.nucleo";

export interface FilaUsuario { id: string; nombre: string; correo: string; rol: Rol; activo: boolean; operadorId: string | null; version: number }
/** operadoresSinUsuario: fichas de operador activas que aún no tienen usuario (para ligarlas). */
export interface ListadoUsuarios { usuarios: FilaUsuario[]; operadoresSinUsuario: OperadorResumen[]; usuarioActualId: string }

/** Permiso usuarios.gestionar. */
export async function listarUsuarios(ctx: Contexto): Promise<Resultado<ListadoUsuarios>> {
  void ctx;
  throw new Error("pendiente: Plan 2 T3 (Claude)");
}
