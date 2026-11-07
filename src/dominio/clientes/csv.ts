import Papa from "papaparse";
import { clienteSchema, erroresPorCampo, type ClienteEntrada } from "./esquemas";
import { clienteNuevo } from "./formulario";
import { escribirHorarios, leerHorarios } from "./horarios";
import { ETIQUETA_UNIDAD } from "./etiquetas";
import { TIPOS_UNIDAD, type ClienteGuardado, type TipoUnidad } from "./tipos";
import { leerUbicacion } from "./ubicacion";

function normalizarTipoUnidad(valor: string): string {
  return valor.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[\s_]+/gu, "");
}

const tiposUnidadPorNombre = new Map<string, TipoUnidad>();
for (const tipo of TIPOS_UNIDAD) {
  tiposUnidadPorNombre.set(normalizarTipoUnidad(tipo), tipo);
  tiposUnidadPorNombre.set(normalizarTipoUnidad(ETIQUETA_UNIDAD[tipo]), tipo);
}

export const LIMITES_CSV = { bytes: 1_000_000, registros: 2000 } as const;

export const COLUMNAS_CSV = [
  "nombre", "contacto", "telefono", "direccion", "lat", "lng", "residuo", "material", "servicio_min", "carga_kg",
  // Plan CRM: la ficha completa viaja por CSV (salvo contactos adicionales, recurrencia, documentos y privacidad).
  "horarios", "tipos_unidad", "notas_acceso", "ubicacion", "correo", "puesto",
] as const;
export type ColumnaCsv = (typeof COLUMNAS_CSV)[number];

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
  /** Plan CRM: avisos que no impiden importar (por ejemplo, la columna id se ignora). */
  avisos: string[];
  validas: FilaValida[];
  errores: ErrorDeImportacion[];
  registros: number;
}

export type PosibleDuplicado =
  | { fila: number; nombre: string; con: "archivo"; otraFila: number }
  | { fila: number; nombre: string; con: "cartera"; clienteId: string; nombreExistente: string };

export function separadorDe(contenido: string): "," | ";" | "\t" {
  const encabezado = contenido.split(/[\r\n]/, 1)[0] ?? "";
  let separador: "," | ";" | "\t" = ",";
  let mayor = 0;
  for (const candidato of [",", ";", "\t"] as const) {
    const apariciones = encabezado.split(candidato).length - 1;
    if (apariciones > mayor) {
      separador = candidato;
      mayor = apariciones;
    }
  }
  return separador;
}

/** Convierte el CSV exportado desde Excel en entradas validadas, con los errores por fila. */
export function analizarClientesCsv(entradaCruda: string | Uint8Array): AnalisisCsv {
  const contenido = typeof entradaCruda === "string" ? entradaCruda : decodificar(entradaCruda);
  const resultado: AnalisisCsv = { validas: [], errores: [], registros: 0, avisos: [] };
  const errorArchivo = (mensaje: string) => {
    resultado.errores.push({ fila: null, mensajes: [mensaje] });
    return resultado;
  };
  if (new TextEncoder().encode(contenido).byteLength > LIMITES_CSV.bytes) {
    return errorArchivo(`El archivo supera el límite de ${LIMITES_CSV.bytes} bytes`);
  }
  // Sin header: true para detectar repeticiones antes del renombrado automático del lector.
  // La barra separa tipos_unidad, no columnas; el encabezado determina el separador CSV.
  const leido = Papa.parse<string[]>(contenido.replace(/^\uFEFF/, ""), { skipEmptyLines: false, delimiter: separadorDe(contenido) });
  const encabezados = (leido.data[0] ?? []).map((h) => h.trim().toLowerCase());
  const erroresPorFila = new Map<number, string[]>();
  for (const error of leido.errors) {
    const fila = typeof error.row === "number" ? error.row + 1 : null;
    const mensaje = error.code === "MissingQuotes" ? "Campo con comillas sin cerrar" : "No se pudo leer el registro CSV: comillas inválidas";
    if (fila === null) resultado.errores.push({ fila, mensajes: [mensaje] });
    else erroresPorFila.set(fila, [...(erroresPorFila.get(fila) ?? []), mensaje]);
  }
  if (erroresPorFila.has(1)) resultado.errores.push({ fila: 1, mensajes: erroresPorFila.get(1)! });
  if (!encabezados.includes("nombre")) return errorArchivo('Falta la columna obligatoria "nombre"');
  if (new Set(encabezados).size !== encabezados.length) return errorArchivo("Hay encabezados repetidos");
  if (encabezados.includes("id")) resultado.avisos.push("La columna id se ignora: la importación solo da de alta clientes nuevos");

  leido.data.slice(1).forEach((valores, indice) => {
    const fila = indice + 2;
    const mensajes = erroresPorFila.get(fila) ?? [];
    if (valores.every((v) => typeof v === "string" && v.trim() === "") && mensajes.length === 0) return;
    resultado.registros++;
    if (valores.length !== encabezados.length) mensajes.push("El número de campos no coincide con el encabezado");
    const campos: Record<string, string> = Object.fromEntries(encabezados.map((h, i) => [h, valores[i] ?? ""]));
    const texto = (campo: string): string | null => {
      const valor = campos[campo];
      if (typeof valor !== "string") return null;
      // Revierte solo un apóstrofo protector de la exportación, antes de validar.
      const desprotegido = /^'[=+@\t\r'-]/.test(valor) ? valor.slice(1) : valor;
      return desprotegido.trim() || null;
    };
    const numero = (campo: string): number | null => {
      const valor = texto(campo);
      return valor === null ? null : Number(valor.replace(",", "."));
    };
    // Plan CRM: horarios, tipos de unidad y ubicación pegada.
    const horarios = leerHorarios(texto("horarios") ?? "");
    if (!horarios.ok) mensajes.push(horarios.mensaje);
    const nombresTipos = (texto("tipos_unidad") ?? "").split("|").map(t => t.trim()).filter(Boolean);
    const desconocidos = nombresTipos.filter(t => !tiposUnidadPorNombre.has(normalizarTipoUnidad(t)));
    if (desconocidos.length) mensajes.push(`Tipo de unidad no reconocido: ${desconocidos.join(", ")}; usa ${TIPOS_UNIDAD.join(", ")} separados por |`);
    const tipos = nombresTipos.flatMap(t => {
      const tipo = tiposUnidadPorNombre.get(normalizarTipoUnidad(t));
      return tipo === undefined ? [] : [tipo];
    });
    let lat = numero("lat"), lng = numero("lng");
    const ubicacionTexto = texto("ubicacion");
    if (ubicacionTexto !== null) {
      const u = leerUbicacion(ubicacionTexto);
      if (!u.ok) mensajes.push(u.mensaje);
      else if (lat !== null || lng !== null) {
        if (Math.abs((lat ?? NaN) - u.lat) > 1e-6 || Math.abs((lng ?? NaN) - u.lng) > 1e-6) mensajes.push("La ubicación no coincide con lat y lng");
      } else { lat = u.lat; lng = u.lng; }
    }
    const validado = clienteSchema.safeParse({
      ...clienteNuevo(),
      contactoCorreo: texto("correo"),
      contactoPuesto: texto("puesto"),
      notasAcceso: texto("notas_acceso"),
      tiposUnidadAdmitidos: desconocidos.length ? [] : [...new Set(tipos)],
      ventanas: horarios.ok ? horarios.ventanas : [],
      nombre: texto("nombre") ?? "",
      contactoNombre: texto("contacto"),
      contactoTelefono: texto("telefono"),
      direccion: texto("direccion"),
      lat,
      lng,
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

/** Avisa con qué primera fila anterior o cliente de menor id se repite un nombre normalizado; no lista todos los pares. */
export function posiblesDuplicados(validas: FilaValida[], cartera: { id: string; nombre: string }[]): PosibleDuplicado[] {
  const duplicados: PosibleDuplicado[] = [];
  const primerasFilas = new Map<string, number>();
  const primerosClientes = new Map<string, { id: string; nombre: string }>();
  for (const cliente of cartera) {
    const normalizado = nombreNormalizado(cliente.nombre);
    const anterior = primerosClientes.get(normalizado);
    if (anterior === undefined || cliente.id < anterior.id) primerosClientes.set(normalizado, cliente);
  }
  for (const { fila, entrada } of [...validas].sort((a, b) => a.fila - b.fila)) {
    const nombre = entrada.nombre;
    const normalizado = nombreNormalizado(nombre);
    const otraFila = primerasFilas.get(normalizado);
    if (otraFila === undefined) primerasFilas.set(normalizado, fila);
    else duplicados.push({ fila, nombre, con: "archivo", otraFila });
    const cliente = primerosClientes.get(normalizado);
    if (cliente !== undefined) duplicados.push({ fila, nombre, con: "cartera", clienteId: cliente.id, nombreExistente: cliente.nombre });
  }
  return duplicados;
}

/** UTF-8 si es válido; si no, Windows-1252, la codificación de "CSV (delimitado por comas)" de Excel en español. */
function decodificar(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Una fila con las columnas de la plantilla: lo que exporta el sistema se vuelve a importar igual (Plan CRM, §4.1). */
export function filaCsvDeCliente(c: ClienteGuardado): Record<ColumnaCsv, string> {
  const n = (v: number | null) => (v === null ? "" : String(v));
  return {
    nombre: c.nombre, contacto: c.contactoNombre ?? "", telefono: c.contactoTelefono ?? "", direccion: c.direccion ?? "",
    lat: n(c.lat), lng: n(c.lng), residuo: c.tipoResiduo ?? "", material: c.material ?? "",
    servicio_min: String(c.tiempoServicioMin), carga_kg: n(c.cargaEstimadaKg),
    horarios: escribirHorarios(c.ventanas), tipos_unidad: c.tiposUnidadAdmitidos.join("|"), notas_acceso: c.notasAcceso ?? "",
    ubicacion: "", correo: c.contactoCorreo ?? "", puesto: c.contactoPuesto ?? "",
  };
}
