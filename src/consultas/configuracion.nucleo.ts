import type { Contexto, Resultado } from "@/acciones/tipos";

/** Horas "HH:MM"; diasOperacion: 0 = domingo … 6 = sábado. */
export interface ConfiguracionVista {
  patioLat: number | null; patioLng: number | null; turnoInicio: string; turnoFin: string;
  velocidadKmh: number; factorCircuidad: number; descargaMin: number; cargaPorOmisionKg: number;
  diasOperacion: number[]; diasParaAtrasada: number; versionAvisoPrivacidad: string; version: number;
  estiloMapaUrl: string;
}

/** Permiso configuracion.editar. */
export async function obtenerConfiguracion(ctx: Contexto): Promise<Resultado<ConfiguracionVista>> {
  void ctx;
  throw new Error("pendiente: Plan 2 T3 (Claude)");
}
