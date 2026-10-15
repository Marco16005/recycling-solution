import type { Contexto, Resultado } from "@/acciones/tipos";
import type { Diagnostico, MotivoBloqueoMotor, MotivoPospuesta, Plan } from "@/motor";
import type { OperadorResumen, UnidadResumen } from "./flota.nucleo";

/** Contrato del Plan 4, §3.3. Horas como "HH:MM" en Ciudad de México. */
export interface ParadaVista {
  solicitudId: string;
  folio: string;
  secuencia: number;
  cliente: { id: string; nombre: string; lat: number; lng: number; direccion: string | null };
  ventana: { inicio: string; fin: string };
  llegada: string;
  inicio: string;
  fin: string;
  esperaMin: number;
  cargaKg: number;
  kmDesdeAnterior: number;
}

export interface ViajeVista {
  numero: number;
  salida: string;
  regreso: string;
  finDescarga: string;
  cargaKg: number;
  capacidadKg: number;
  km: number;
  paradas: ParadaVista[];
}

export interface UnidadEnPlan { jornadaId: string; unidad: UnidadResumen; operador: OperadorResumen; viajes: ViajeVista[] }

export interface VistaPlan {
  fecha: string;
  planId: string | null;
  estado: "sin_plan" | "propuesto" | "validado";
  version: number | null;
  generadoEn: Date | null;
  revisionIniciada: boolean;
  /** Cuántos ajustes manuales tiene; 0 si es el plan del motor. */
  ajustes: number;
  patio: { lat: number; lng: number } | null;
  unidades: UnidadEnPlan[];
  pospuestas: { solicitudId: string; folio: string; cliente: string; motivo: MotivoPospuesta; diagnostico: Diagnostico | null }[];
  /** Solo bloqueos físicos del motor (carga mayor que cualquier unidad). Los clientes bloqueados no llegan al motor: están en la cola. */
  bloqueadas: { solicitudId: string; folio: string; cliente: string; motivo: MotivoBloqueoMotor }[];
  resumen: Plan["resumen"] | null;
  ultimaEjecucion: { duracionMs: number; resultado: "ok" | "error" | "tiempo_agotado"; en: Date } | null;
  /** Solicitudes listas para la fecha registradas o liberadas después de generar: invitan a regenerar. */
  nuevasDesdeGeneracion: number;
  requisitos: { jornadaId: string; operador: string; clientes: { nombre: string; tipos: string[] }[] }[];
  puedeGenerar: boolean;
  puedeValidar: boolean;
  estiloMapaUrl: string;
}

/** Permiso planes.ver. El validado de la fecha o, si no hay, el propuesto vigente. fecha: "AAAA-MM-DD" o undefined para hoy. */
export async function obtenerPlan(ctx: Contexto, fecha: unknown): Promise<Resultado<VistaPlan>> {
  void ctx;
  void fecha;
  throw new Error("pendiente");
}
