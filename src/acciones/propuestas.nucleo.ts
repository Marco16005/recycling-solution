import type { Contexto, Resultado } from "./tipos";

/** Plan CRM, §4.4: propuestas de recolección que confirma el despachador (permiso solicitudes.registrar). Se implementa en PC-3. */

export async function confirmarPropuestas(ctx: Contexto, fecha: unknown, clienteIds: unknown):
  Promise<Resultado<{ creadas: { clienteId: string; solicitudId: string; folio: string }[]; yaConfirmadas: string[] }>> {
  void ctx; void fecha; void clienteIds;
  throw new Error("pendiente: PC-3");
}

/** dias: 1 a 30. */
export async function posponerPropuesta(ctx: Contexto, fecha: unknown, clienteId: unknown, dias: unknown): Promise<Resultado<null>> {
  void ctx; void fecha; void clienteId; void dias;
  throw new Error("pendiente: PC-3");
}

export async function descartarPropuesta(ctx: Contexto, fecha: unknown, clienteId: unknown, nota: unknown): Promise<Resultado<null>> {
  void ctx; void fecha; void clienteId; void nota;
  throw new Error("pendiente: PC-3");
}
