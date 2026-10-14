import type { ClienteEntrada } from "@/dominio/clientes/esquemas";

const CAMPOS = [
  "nombre", "contactoNombre", "contactoTelefono", "direccion", "lat", "lng", "tipoResiduo", "material",
  "tiposUnidadAdmitidos", "notasAcceso", "tiempoServicioMin", "cargaEstimadaKg", "activo", "ventanas", "documentos",
] as const satisfies readonly (keyof ClienteEntrada)[];

const tieneValor = (v: unknown) => v !== null && !(Array.isArray(v) && v.length === 0);

/**
 * Nombres de los campos que cambiaron, para la bitácora (nunca sus valores). Al crear (antes = null), los que tienen valor.
 * Ventanas y documentos se comparan sin importar el orden en que llegaron.
 */
export function camposCambiados(antes: ClienteEntrada | null, despues: ClienteEntrada): string[] {
  if (antes === null) return CAMPOS.filter((campo) => tieneValor(despues[campo]));
  const comparable = (v: unknown) =>
    Array.isArray(v) ? JSON.stringify(v.map((x) => JSON.stringify(x)).sort()) : JSON.stringify(v);
  return CAMPOS.filter((campo) => comparable(antes[campo]) !== comparable(despues[campo]));
}

/** Igual que camposCambiados, para cualquier registro: compara solo los campos indicados. */
export function camposDistintos<T extends object>(antes: T | null, despues: T, campos: readonly (keyof T & string)[]): string[] {
  if (antes === null) return campos.filter((campo) => tieneValor(despues[campo]));
  const comparable = (v: unknown) =>
    Array.isArray(v) ? JSON.stringify(v.map((x) => JSON.stringify(x)).sort()) : JSON.stringify(v);
  return campos.filter((campo) => comparable(antes[campo]) !== comparable(despues[campo]));
}
