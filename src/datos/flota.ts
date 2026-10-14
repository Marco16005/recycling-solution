import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type {
  AplicaDocumento, DocumentoRegistrado, OperadorEntrada, OperadorGuardado, TipoDocumento, UnidadEntrada, UnidadGuardada,
} from "@/dominio/flota/tipos";
import type { BD, Tx } from "./bd";
import type { ResultadoActualizacion } from "./clientes";
import { documentosOperador, documentosUnidad, operadores, tiposDocumento, unidades } from "./esquema";

type Conexion = BD | Tx;

export async function leerCatalogo(bd: Conexion, aplicaA?: AplicaDocumento): Promise<TipoDocumento[]> {
  return bd
    .select()
    .from(tiposDocumento)
    .where(aplicaA ? eq(tiposDocumento.aplicaA, aplicaA) : undefined)
    .orderBy(asc(tiposDocumento.nombre));
}

const comoDocumento = (d: { tipoDocumentoId: string; obligatorio: boolean; estado: DocumentoRegistrado["estado"]; venceEl: string | null; notas: string | null }): DocumentoRegistrado => ({
  tipoDocumentoId: d.tipoDocumentoId,
  obligatorio: d.obligatorio,
  estado: d.estado,
  venceEl: d.venceEl,
  notas: d.notas,
});

// ---------- Unidades

function columnasUnidad(e: UnidadEntrada) {
  return {
    placa: e.placa,
    numeroEconomico: e.numeroEconomico,
    tipo: e.tipo,
    capacidadKg: e.capacidadKg,
    rendimientoKmL: e.rendimientoKmL,
    activo: e.activo,
    notas: e.notas,
  };
}

async function reemplazarDocumentosUnidad(tx: Tx, unidadId: string, docs: DocumentoRegistrado[]): Promise<void> {
  await tx.delete(documentosUnidad).where(eq(documentosUnidad.unidadId, unidadId));
  if (docs.length > 0) await tx.insert(documentosUnidad).values(docs.map((d) => ({ unidadId, ...d })));
}

export async function insertarUnidad(tx: Tx, e: UnidadEntrada, ahora: Date): Promise<{ id: string; version: number }> {
  const [fila] = await tx
    .insert(unidades)
    .values({ ...columnasUnidad(e), creadoEn: ahora, actualizadoEn: ahora })
    .returning({ id: unidades.id, version: unidades.version });
  await reemplazarDocumentosUnidad(tx, fila.id, e.documentos);
  return fila;
}

export async function actualizarUnidadSiVersion(tx: Tx, id: string, version: number, e: UnidadEntrada, ahora: Date): Promise<ResultadoActualizacion> {
  const [fila] = await tx
    .update(unidades)
    .set({ ...columnasUnidad(e), actualizadoEn: ahora, version: sql`${unidades.version} + 1` })
    .where(and(eq(unidades.id, id), eq(unidades.version, version)))
    .returning({ version: unidades.version });
  if (fila) {
    await reemplazarDocumentosUnidad(tx, id, e.documentos);
    return { estado: "actualizado", version: fila.version };
  }
  const [existe] = await tx.select({ id: unidades.id }).from(unidades).where(eq(unidades.id, id));
  return existe ? { estado: "conflicto" } : { estado: "no_encontrado" };
}

/** Sin ids: todas, ordenadas por placa. */
export async function leerUnidades(bd: Conexion, ids?: string[]): Promise<UnidadGuardada[]> {
  const filas = await bd
    .select()
    .from(unidades)
    .where(ids ? inArray(unidades.id, ids) : undefined)
    .orderBy(asc(unidades.placa));
  if (filas.length === 0) return [];
  const docs = await bd
    .select()
    .from(documentosUnidad)
    .where(inArray(documentosUnidad.unidadId, filas.map((f) => f.id)))
    .orderBy(asc(documentosUnidad.tipoDocumentoId));
  return filas.map((u) => ({
    id: u.id,
    version: u.version,
    placa: u.placa,
    numeroEconomico: u.numeroEconomico,
    tipo: u.tipo,
    capacidadKg: u.capacidadKg,
    rendimientoKmL: u.rendimientoKmL,
    activo: u.activo,
    notas: u.notas,
    documentos: docs.filter((d) => d.unidadId === u.id).map(comoDocumento),
  }));
}

export async function leerUnidad(bd: Conexion, id: string): Promise<UnidadGuardada | null> {
  return (await leerUnidades(bd, [id]))[0] ?? null;
}

/** Ids de unidades con esa placa o número económico, sin contar excluirId. */
export async function unidadesConPlacaONumero(bd: Conexion, placa: string, numeroEconomico: string | null, excluirId: string | null) {
  const filas = await bd
    .select({ id: unidades.id, placa: unidades.placa, numeroEconomico: unidades.numeroEconomico })
    .from(unidades)
    .where(
      numeroEconomico === null
        ? eq(unidades.placa, placa)
        : sql`${unidades.placa} = ${placa} OR ${unidades.numeroEconomico} = ${numeroEconomico}`,
    );
  return filas.filter((f) => f.id !== excluirId);
}

// ---------- Operadores

function columnasOperador(e: OperadorEntrada) {
  return { nombre: e.nombre, telefono: e.telefono, activo: e.activo };
}

async function reemplazarDocumentosOperador(tx: Tx, operadorId: string, docs: DocumentoRegistrado[]): Promise<void> {
  await tx.delete(documentosOperador).where(eq(documentosOperador.operadorId, operadorId));
  if (docs.length > 0) await tx.insert(documentosOperador).values(docs.map((d) => ({ operadorId, ...d })));
}

export async function insertarOperador(tx: Tx, e: OperadorEntrada, ahora: Date): Promise<{ id: string; version: number }> {
  const [fila] = await tx
    .insert(operadores)
    .values({ ...columnasOperador(e), creadoEn: ahora, actualizadoEn: ahora })
    .returning({ id: operadores.id, version: operadores.version });
  await reemplazarDocumentosOperador(tx, fila.id, e.documentos);
  return fila;
}

export async function actualizarOperadorSiVersion(tx: Tx, id: string, version: number, e: OperadorEntrada, ahora: Date): Promise<ResultadoActualizacion> {
  const [fila] = await tx
    .update(operadores)
    .set({ ...columnasOperador(e), actualizadoEn: ahora, version: sql`${operadores.version} + 1` })
    .where(and(eq(operadores.id, id), eq(operadores.version, version)))
    .returning({ version: operadores.version });
  if (fila) {
    await reemplazarDocumentosOperador(tx, id, e.documentos);
    return { estado: "actualizado", version: fila.version };
  }
  const [existe] = await tx.select({ id: operadores.id }).from(operadores).where(eq(operadores.id, id));
  return existe ? { estado: "conflicto" } : { estado: "no_encontrado" };
}

/** Registra la entrega del aviso (versión y fecha) si la versión del operador coincide. */
export async function registrarEntregaAvisoSiVersion(tx: Tx, id: string, version: number, versionAviso: string, ahora: Date): Promise<ResultadoActualizacion> {
  const [fila] = await tx
    .update(operadores)
    .set({ avisoVersion: versionAviso, avisoEntregadoEn: ahora, actualizadoEn: ahora, version: sql`${operadores.version} + 1` })
    .where(and(eq(operadores.id, id), eq(operadores.version, version)))
    .returning({ version: operadores.version });
  if (fila) return { estado: "actualizado", version: fila.version };
  const [existe] = await tx.select({ id: operadores.id }).from(operadores).where(eq(operadores.id, id));
  return existe ? { estado: "conflicto" } : { estado: "no_encontrado" };
}

export async function leerOperadores(bd: Conexion, ids?: string[]): Promise<OperadorGuardado[]> {
  const filas = await bd
    .select()
    .from(operadores)
    .where(ids ? inArray(operadores.id, ids) : undefined)
    .orderBy(asc(operadores.nombre), asc(operadores.id));
  if (filas.length === 0) return [];
  const docs = await bd
    .select()
    .from(documentosOperador)
    .where(inArray(documentosOperador.operadorId, filas.map((f) => f.id)))
    .orderBy(asc(documentosOperador.tipoDocumentoId));
  return filas.map((o) => ({
    id: o.id,
    version: o.version,
    nombre: o.nombre,
    telefono: o.telefono,
    activo: o.activo,
    avisoVersion: o.avisoVersion,
    avisoEntregadoEn: o.avisoEntregadoEn,
    documentos: docs.filter((d) => d.operadorId === o.id).map(comoDocumento),
  }));
}

export async function leerOperador(bd: Conexion, id: string): Promise<OperadorGuardado | null> {
  return (await leerOperadores(bd, [id]))[0] ?? null;
}
