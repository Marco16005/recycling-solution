import type { Contexto, Resultado } from "@/acciones/tipos";
import type { MotivoNoDisponible } from "@/dominio/flota/tipos";
import type { OperadorResumen, UnidadResumen } from "./flota.nucleo";

/** disponibleDesde: "HH:MM". */
export interface JornadaGuardada {
  id: string; fecha: string; unidadId: string; operadorId: string; disponibleDesde: string;
  checkInEn: Date | null; checkOutEn: Date | null; notas: string | null; version: number;
}
export type FilaJornada = JornadaGuardada & { unidad: UnidadResumen; operador: OperadorResumen };
export interface NoDisponible { tipo: "unidad" | "operador"; id: string; nombre: string; motivos: MotivoNoDisponible[] }
/** libres: activos, disponibles en la fecha y sin jornada ese día. */
export interface VistaJornada {
  fecha: string; jornadas: FilaJornada[]; unidadesLibres: UnidadResumen[]; operadoresLibres: OperadorResumen[];
  noDisponibles: NoDisponible[]; puedeGestionar: boolean;
}

/** Permiso flota.ver. fecha: "AAAA-MM-DD", o undefined para hoy en Ciudad de México. */
export async function obtenerJornada(ctx: Contexto, fecha: unknown): Promise<Resultado<VistaJornada>> {
  void ctx; void fecha;
  throw new Error("pendiente: Plan 2 T3 (Claude)");
}
