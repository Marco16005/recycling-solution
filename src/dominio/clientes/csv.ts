import Papa from "papaparse";
import { clienteSchema, erroresPorCampo, type ClienteEntrada } from "./esquemas";
import { clienteNuevo } from "./formulario";

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
  const resultado: AnalisisCsv = { validas: [], errores: [], registros: 0 };
  const errorArchivo = (mensaje: string) => {
    resultado.errores.push({ fila: null, mensajes: [mensaje] });
    return resultado;
  };
  if (new TextEncoder().encode(contenido).byteLength > LIMITES_CSV.bytes) {
    return errorArchivo(`El archivo supera el límite de ${LIMITES_CSV.bytes} bytes`);
  }
  // Sin header: true para detectar repeticiones antes del renombrado automático del lector.
  const leido = Papa.parse<string[]>(contenido.replace(/^\uFEFF/, ""), { skipEmptyLines: false });
  const encabezados = (leido.data[0] ?? []).map((h) => h.trim().toLowerCase());
  const erroresPorFila = new Map<number, string[]>();
  for (const error of leido.errors) {
    // Un archivo de una sola columna es válido; Papa usa coma si no detecta separador.
    if (error.code === "UndetectableDelimiter") continue;
    const fila = typeof error.row === "number" ? error.row + 1 : null;
    const mensaje = error.code === "MissingQuotes" ? "Campo con comillas sin cerrar" : "No se pudo leer el registro CSV: comillas inválidas";
    if (fila === null) resultado.errores.push({ fila, mensajes: [mensaje] });
    else erroresPorFila.set(fila, [...(erroresPorFila.get(fila) ?? []), mensaje]);
  }
  if (erroresPorFila.has(1)) resultado.errores.push({ fila: 1, mensajes: erroresPorFila.get(1)! });
  if (!encabezados.includes("nombre")) return errorArchivo('Falta la columna obligatoria "nombre"');
  if (new Set(encabezados).size !== encabezados.length) return errorArchivo("Hay encabezados repetidos");

  leido.data.slice(1).forEach((valores, indice) => {
    const fila = indice + 2;
    const mensajes = erroresPorFila.get(fila) ?? [];
    if (valores.every((v) => typeof v === "string" && v.trim() === "") && mensajes.length === 0) return;
    resultado.registros++;
    if (valores.length !== encabezados.length) mensajes.push("El número de campos no coincide con el encabezado");
    const campos: Record<string, string> = Object.fromEntries(encabezados.map((h, i) => [h, valores[i] ?? ""]));
    const texto = (campo: string): string | null => {
      const valor = campos[campo];
      return typeof valor === "string" ? valor.trim() || null : null;
    };
    const numero = (campo: string): number | null => {
      const valor = texto(campo);
      return valor === null ? null : Number(valor.replace(",", "."));
    };
    const validado = clienteSchema.safeParse({
      ...clienteNuevo(),
      nombre: texto("nombre") ?? "",
      contactoNombre: texto("contacto"),
      contactoTelefono: texto("telefono"),
      direccion: texto("direccion"),
      lat: numero("lat"),
      lng: numero("lng"),
      tipoResiduo: texto("residuo")?.toUpperCase() ?? null,
      material: texto("material"),
      tiempoServicioMin: numero("servicio_min") ?? 66,
      cargaEstimadaKg: numero("carga_kg"),
    });
    if (!validado.success) {
      for (const [campo, errores] of Object.entries(erroresPorCampo(validado.error))) {
        mensajes.push(`${campo}: ${errores.join("; ")}`);
      }
    }
    if (mensajes.length > 0) resultado.errores.push({ fila, mensajes });
    else if (validado.success) resultado.validas.push({ fila, entrada: validado.data });
  });
  if (resultado.registros > LIMITES_CSV.registros) {
    resultado.validas = [];
    return errorArchivo(`El archivo supera el límite de ${LIMITES_CSV.registros} registros`);
  }
  return resultado;
}

/** Minúsculas, sin acentos, sin signos, espacios colapsados. */
export function nombreNormalizado(nombre: string): string {
  return nombre.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "").trim().replace(/\s+/g, " ");
}

/** Filas válidas cuyo nombre normalizado coincide con otra fila del archivo o con un cliente de la cartera. */
export function posiblesDuplicados(validas: FilaValida[], cartera: { id: string; nombre: string }[]): PosibleDuplicado[] {
  const duplicados: PosibleDuplicado[] = [];
  const anteriores = new Map<string, number[]>();
  const carteraOrdenada = [...cartera].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const { fila, entrada } of [...validas].sort((a, b) => a.fila - b.fila)) {
    const nombre = entrada.nombre;
    const normalizado = nombreNormalizado(nombre);
    const filas = anteriores.get(normalizado) ?? [];
    for (const otraFila of filas) duplicados.push({ fila, nombre, con: "archivo", otraFila });
    for (const cliente of carteraOrdenada) {
      if (nombreNormalizado(cliente.nombre) === normalizado) {
        duplicados.push({ fila, nombre, con: "cartera", clienteId: cliente.id, nombreExistente: cliente.nombre });
      }
    }
    anteriores.set(normalizado, [...filas, fila]);
  }
  return duplicados;
}
