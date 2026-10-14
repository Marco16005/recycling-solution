import type { ClienteEntrada } from "./esquemas";

export const LIMITES_CSV = { bytes: 1_000_000, registros: 2000 } as const;

export const COLUMNAS_CSV = [
  "nombre", "contacto", "telefono", "direccion", "lat", "lng", "residuo", "material", "servicio_min", "carga_kg",
] as const;

/** fila: número de fila como la muestra Excel (encabezado = 1). null = error del archivo completo. */
export interface ErrorDeImportacion {
  fila: number | null;
  mensajes: string[];
}

export interface FilaValida {
  fila: number;
  entrada: ClienteEntrada;
}

/** registros: registros de datos no vacíos leídos del archivo. */
export interface AnalisisCsv {
  validas: FilaValida[];
  errores: ErrorDeImportacion[];
  registros: number;
}

export type PosibleDuplicado =
  | { fila: number; nombre: string; con: "archivo"; otraFila: number }
  | { fila: number; nombre: string; con: "cartera"; clienteId: string; nombreExistente: string };

/** Convierte el CSV exportado desde Excel en entradas validadas, con los errores por fila. */
export function analizarClientesCsv(contenido: string): AnalisisCsv {
  void contenido;
  throw new Error("pendiente: T3 (Codex)");
}

/** Minúsculas, sin acentos, sin signos, espacios colapsados. */
export function nombreNormalizado(nombre: string): string {
  void nombre;
  throw new Error("pendiente: T3 (Codex)");
}

/** Filas válidas cuyo nombre normalizado coincide con otra fila del archivo o con un cliente de la cartera. */
export function posiblesDuplicados(validas: FilaValida[], cartera: { id: string; nombre: string }[]): PosibleDuplicado[] {
  void validas;
  void cartera;
  throw new Error("pendiente: T3 (Codex)");
}
