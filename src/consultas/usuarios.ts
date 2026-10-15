import "server-only";
import type { Resultado } from "@/acciones/tipos";
import { contextoDeLaPeticion } from "@/seguridad/sesion";
import { listarUsuarios, type ListadoUsuarios } from "./usuarios.nucleo";

export type * from "./usuarios.nucleo";

export async function listarUsuariosConsulta(): Promise<Resultado<ListadoUsuarios>> {
  return listarUsuarios(await contextoDeLaPeticion());
}
