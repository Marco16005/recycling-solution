import "server-only";
import type { Resultado } from "@/acciones/tipos";
import { contextoDeLaPeticion } from "@/seguridad/sesion";
import {
  listarClientes, obtenerContextoAlta, obtenerFicha, type ContextoAlta, type FichaCliente, type ListadoClientes,
} from "./clientes.nucleo";

export type { ClienteResumen, ContextoAlta, FichaCliente, ListadoClientes } from "./clientes.nucleo";

export async function listarClientesConsulta(filtro: { texto?: string }): Promise<Resultado<ListadoClientes>> {
  return listarClientes(await contextoDeLaPeticion(), filtro);
}

export async function obtenerFichaConsulta(id: string): Promise<Resultado<FichaCliente>> {
  return obtenerFicha(await contextoDeLaPeticion(), id);
}

export async function obtenerContextoAltaConsulta(): Promise<Resultado<ContextoAlta>> {
  return obtenerContextoAlta(await contextoDeLaPeticion());
}
