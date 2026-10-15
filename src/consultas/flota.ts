import "server-only";
import type { Resultado } from "@/acciones/tipos";
import { contextoDeLaPeticion } from "@/seguridad/sesion";
import {
  contextoAltaFlota, listarOperadores, listarUnidades, obtenerOperador, obtenerUnidad,
  type ContextoAltaFlota, type FichaOperador, type FichaUnidad, type ListadoOperadores, type ListadoUnidades,
} from "./flota.nucleo";

export type * from "./flota.nucleo";

export async function listarUnidadesConsulta(filtro: { texto?: string; incluirInactivas?: boolean }): Promise<Resultado<ListadoUnidades>> {
  return listarUnidades(await contextoDeLaPeticion(), filtro);
}

export async function listarOperadoresConsulta(filtro: { texto?: string; incluirInactivos?: boolean }): Promise<Resultado<ListadoOperadores>> {
  return listarOperadores(await contextoDeLaPeticion(), filtro);
}

export async function obtenerUnidadConsulta(id: string): Promise<Resultado<FichaUnidad>> {
  return obtenerUnidad(await contextoDeLaPeticion(), id);
}

export async function obtenerOperadorConsulta(id: string): Promise<Resultado<FichaOperador>> {
  return obtenerOperador(await contextoDeLaPeticion(), id);
}

export async function contextoAltaFlotaConsulta(): Promise<Resultado<ContextoAltaFlota>> {
  return contextoAltaFlota(await contextoDeLaPeticion());
}
