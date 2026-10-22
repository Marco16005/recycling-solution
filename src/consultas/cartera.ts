import "server-only";
import { contextoDeLaPeticion } from "@/seguridad/sesion";
import { fichaCartera, mapaCartera, propuestasDeRecoleccion } from "./cartera.nucleo";

export async function fichaCarteraConsulta(clienteId: string, pagina?: number) {
  return fichaCartera(await contextoDeLaPeticion(), clienteId, pagina);
}

export async function mapaCarteraConsulta(filtros: unknown) {
  return mapaCartera(await contextoDeLaPeticion(), filtros);
}

export async function propuestasDeRecoleccionConsulta(fecha?: string) {
  return propuestasDeRecoleccion(await contextoDeLaPeticion(), fecha);
}
