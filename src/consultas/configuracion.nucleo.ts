import { permitir } from "@/acciones/autorizacion";
import type { Contexto, Resultado } from "@/acciones/tipos";
import { leerConfiguracionCompleta } from "@/datos/configuracion";
import { estiloMapaUrl } from "./mapa";
import type { LineaBase } from "@/datos/configuracion";

/** Horas "HH:MM"; diasOperacion: 0 = domingo … 6 = sábado. */
export interface ConfiguracionVista {
  patioLat: number | null; patioLng: number | null; turnoInicio: string; turnoFin: string;
  velocidadKmh: number; factorCircuidad: number; descargaMin: number; cargaPorOmisionKg: number;
  diasOperacion: number[]; diasParaAtrasada: number; versionAvisoPrivacidad: string; version: number;
  lineaBase: LineaBase;
  estiloMapaUrl: string;
}

/** Permiso configuracion.editar. */
export async function obtenerConfiguracion(ctx: Contexto): Promise<Resultado<ConfiguracionVista>> {
  const permiso = permitir(ctx, "configuracion.editar");
  if (!permiso.ok) return permiso;
  return { ok: true, valor: { ...(await leerConfiguracionCompleta(ctx.bd)), estiloMapaUrl: estiloMapaUrl() } };
}
