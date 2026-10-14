import type { DocumentoRegistrado, MotivoNoDisponible, Operador, TipoDocumento, Unidad } from "./tipos";

/**
 * Por qué la unidad no puede salir en la fecha ("AAAA-MM-DD"). Vacía = disponible.
 * Un documento obligatorio (por la entidad o, sin renglón, por omisión del catálogo) faltante o no vigente la bloquea.
 * Orden: el de CodigoNoDisponible; dentro de cada código, por nombre del documento.
 */
export function motivosNoDisponibleUnidad(u: Unidad, catalogo: TipoDocumento[], fecha: string): MotivoNoDisponible[] {
  void u;
  void catalogo;
  void fecha;
  throw new Error("pendiente: Plan 2 T2 (Codex)");
}

/** Igual que la unidad, más aviso_no_entregado si el operador no tiene registrada la entrega del aviso. */
export function motivosNoDisponibleOperador(o: Operador, catalogo: TipoDocumento[], fecha: string): MotivoNoDisponible[] {
  void o;
  void catalogo;
  void fecha;
  throw new Error("pendiente: Plan 2 T2 (Codex)");
}

/** Documentos con vencimiento entre fecha y fecha + dias, ambos incluidos. */
export function documentosPorVencer(docs: DocumentoRegistrado[], fecha: string, dias: number): DocumentoRegistrado[] {
  void docs;
  void fecha;
  void dias;
  throw new Error("pendiente: Plan 2 T2 (Codex)");
}

/** Mayúsculas, sin espacios ni guiones. */
export function normalizarPlaca(placa: string): string {
  void placa;
  throw new Error("pendiente: Plan 2 T2 (Codex)");
}
