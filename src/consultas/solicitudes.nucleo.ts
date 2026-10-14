import type { Contexto, Resultado } from "@/acciones/tipos";
import type { MotivoBloqueo } from "@/dominio/clientes/habilitacion";
import type { ElementoCola } from "@/dominio/solicitudes/tipos";

export type ElementoColaVista = ElementoCola & { cliente: { id: string; nombre: string; direccion: string | null } };
/** elementos: pendientes de cualquier fecha y cerradas cuya fecha solicitada es la consultada, en orden FIFO. */
export interface VistaCola {
  fecha: string; elementos: ElementoColaVista[];
  resumen: { listas: number; bloqueadas: number; atrasadas: number; futuras: number };
  puedeRegistrar: boolean; puedeCancelar: boolean;
}
export interface ClienteParaSolicitud {
  id: string; nombre: string; direccion: string | null; cargaEstimadaKg: number | null; motivosHoy: MotivoBloqueo[];
}

/** Permiso solicitudes.ver. fecha: "AAAA-MM-DD", o undefined para hoy. */
export async function colaDeSolicitudes(ctx: Contexto, fecha: unknown): Promise<Resultado<VistaCola>> {
  void ctx; void fecha;
  throw new Error("pendiente: Plan 2 T3 (Claude)");
}

/** Permiso solicitudes.registrar. Clientes activos cuyo nombre contiene el texto (sin acentos); máximo 10. */
export async function buscarClientesParaSolicitud(ctx: Contexto, texto: unknown): Promise<Resultado<ClienteParaSolicitud[]>> {
  void ctx; void texto;
  throw new Error("pendiente: Plan 2 T3 (Claude)");
}
