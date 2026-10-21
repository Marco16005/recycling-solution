import type { Contexto, Resultado } from "./tipos";

/** Plan CRM, §4.2 y §4.8: ubicación pegada y notas de seguimiento (permiso clientes.editar). Se implementa en PC-3. */

export async function ubicacionDesdeTexto(ctx: Contexto, texto: unknown):
  Promise<Resultado<{ lat: number; lng: number; distanciaCalleM: number | null }>> {
  void ctx; void texto;
  throw new Error("pendiente: PC-3");
}

export type TipoNota = "llamada" | "queja" | "acuerdo" | "otro";

/** entrada: { tipo, texto (hasta 1000), corrigeA?: id de otra nota del mismo cliente }. */
export async function agregarNota(ctx: Contexto, clienteId: unknown, entrada: unknown): Promise<Resultado<{ id: string }>> {
  void ctx; void clienteId; void entrada;
  throw new Error("pendiente: PC-3");
}
