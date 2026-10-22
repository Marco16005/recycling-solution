import type { ClienteEntrada } from "@/dominio/clientes/esquemas";

const CAMPOS = [
  "nombre", "contactoNombre", "contactoTelefono", "direccion", "lat", "lng", "tipoResiduo", "material",
  "tiposUnidadAdmitidos", "notasAcceso", "tiempoServicioMin", "cargaEstimadaKg", "activo", "ventanas", "documentos",
  // Plan CRM.
  "contactoCorreo", "contactoPuesto", "contactosAdicionales", "recurrencia",
] as const satisfies readonly (keyof ClienteEntrada)[];

const tieneValor = (v: unknown) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);

/** Para comparar: un campo nulo y uno ausente valen lo mismo, y el orden de las llaves no importa. */
const sinVacios = (x: unknown): unknown =>
  x !== null && typeof x === "object" && !Array.isArray(x) && !(x instanceof Date)
    ? Object.fromEntries(Object.entries(x).filter(([, v]) => v !== null && v !== undefined).sort(([a], [b]) => a.localeCompare(b)))
    : x;

/**
 * Nombres de los campos que cambiaron, para la bitácora (nunca sus valores). Al crear (antes = null), los que tienen valor.
 * Ventanas y documentos se comparan sin importar el orden en que llegaron.
 */
export function camposCambiados(antes: ClienteEntrada | null, despues: ClienteEntrada): string[] {
  if (antes === null) return CAMPOS.filter((campo) => tieneValor(despues[campo]));
  // Un campo ausente (entrada anterior al Plan CRM) vale lo mismo que vacío.
  const comparable = (v: unknown) =>
    Array.isArray(v) ? JSON.stringify(v.map((x) => JSON.stringify(sinVacios(x))).sort()) : JSON.stringify(v ?? null);
  const vacioSiArreglo = (campo: (typeof CAMPOS)[number], v: unknown) => (v === undefined && (campo === "contactosAdicionales") ? [] : v);
  return CAMPOS.filter((campo) => comparable(vacioSiArreglo(campo, antes[campo])) !== comparable(vacioSiArreglo(campo, despues[campo])));
}

/** Igual que camposCambiados, para cualquier registro: compara solo los campos indicados. */
export function camposDistintos<T extends object>(antes: T | null, despues: T, campos: readonly (keyof T & string)[]): string[] {
  if (antes === null) return campos.filter((campo) => tieneValor(despues[campo]));
  const comparable = (v: unknown) =>
    Array.isArray(v) ? JSON.stringify(v.map((x) => JSON.stringify(sinVacios(x))).sort()) : JSON.stringify(v);
  return campos.filter((campo) => comparable(antes[campo]) !== comparable(despues[campo]));
}
