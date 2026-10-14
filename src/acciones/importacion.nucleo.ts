import type { ErrorDeImportacion, PosibleDuplicado } from "@/dominio/clientes/csv";
import type { Contexto, Resultado } from "./tipos";

/** muestra: las primeras 20 filas válidas. huella: del contenido y de los duplicados; se devuelve al confirmar. */
export interface ResumenImportacion {
  registros: number;
  validas: number;
  errores: ErrorDeImportacion[];
  posiblesDuplicados: PosibleDuplicado[];
  muestra: { fila: number; nombre: string; direccion: string | null }[];
  huella: string;
}

/** Analiza el CSV sin escribir nada. Permiso clientes.importar. */
export async function analizarImportacion(ctx: Contexto, csv: unknown): Promise<Resultado<ResumenImportacion>> {
  void ctx;
  void csv;
  throw new Error("pendiente: T4 (Claude)");
}

/**
 * opciones: { operacionId: uuid; huella: string; aceptarDuplicados: boolean }.
 * Si operacionId ya se confirmó, devuelve el mismo resultado sin escribir. Si no, toma el candado de importación,
 * vuelve a analizar dentro de la transacción y escribe todo el lote o nada.
 * Huella distinta: "conflicto". Con errores: "invalido" con campos.archivo.
 * Con duplicados sin aceptarDuplicados: "invalido" con campos.duplicados.
 */
export async function confirmarImportacion(
  ctx: Contexto,
  csv: unknown,
  opciones: unknown,
): Promise<Resultado<{ importados: number }>> {
  void ctx;
  void csv;
  void opciones;
  throw new Error("pendiente: T4 (Claude)");
}
