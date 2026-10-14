import type { DocumentoCliente, EstadoDocumento } from "./tipos";

/**
 * Estado real de un documento en la fecha dada ("AAAA-MM-DD").
 * Un documento marcado como vigente cuya fecha de vencimiento ya pasó cuenta como vencido.
 */
export function estadoEfectivo(doc: DocumentoCliente, hoy: string): EstadoDocumento {
  if (doc.estado === "vigente" && doc.venceEl !== null && doc.venceEl < hoy) return "vencido";
  return doc.estado;
}

/** Nombres de los documentos obligatorios que impiden programar una recolección en la fecha dada. */
export function documentosQueBloquean(docs: DocumentoCliente[], hoy: string): string[] {
  return docs.filter((d) => d.obligatorio && estadoEfectivo(d, hoy) !== "vigente").map((d) => d.nombre);
}
