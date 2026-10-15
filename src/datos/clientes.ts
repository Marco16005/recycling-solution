import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { ClienteEntrada } from "@/dominio/clientes/esquemas";
import type { ClienteGuardado, EstadoPrivacidad } from "@/dominio/clientes/tipos";
import type { BD, Tx } from "./bd";
import { aceptacionesPrivacidad, clientes, documentosCliente, ventanasCliente } from "./esquema";

type Conexion = BD | Tx;

/** Llave del candado que serializa las escrituras que crean o cambian nombres de clientes. */
const CANDADO_NOMBRES = 727_002;

/**
 * Altas, ediciones e importaciones lo toman antes de leer o escribir nombres, para que una importación que ya revisó
 * sus posibles duplicados no se cruce con un cliente nuevo o renombrado. Se suelta al terminar la transacción.
 */
export async function tomarCandadoDeNombres(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${CANDADO_NOMBRES})`);
}

export type ResultadoActualizacion =
  | { estado: "actualizado"; version: number }
  | { estado: "no_encontrado" }
  | { estado: "conflicto" };

const hhmm = (hora: string) => hora.slice(0, 5);

function columnas(entrada: ClienteEntrada) {
  return {
    nombre: entrada.nombre,
    contactoNombre: entrada.contactoNombre,
    contactoTelefono: entrada.contactoTelefono,
    direccion: entrada.direccion,
    lat: entrada.lat,
    lng: entrada.lng,
    tipoResiduo: entrada.tipoResiduo,
    material: entrada.material,
    tiposUnidadAdmitidos: entrada.tiposUnidadAdmitidos,
    notasAcceso: entrada.notasAcceso,
    tiempoServicioMin: entrada.tiempoServicioMin,
    cargaEstimadaKg: entrada.cargaEstimadaKg,
    activo: entrada.activo,
  };
}

/** Sustituye ventanas y documentos del cliente por los de la entrada. */
export async function reemplazarHijos(tx: Tx, clienteId: string, entrada: ClienteEntrada): Promise<void> {
  await tx.delete(ventanasCliente).where(eq(ventanasCliente.clienteId, clienteId));
  await tx.delete(documentosCliente).where(eq(documentosCliente.clienteId, clienteId));
  if (entrada.ventanas.length > 0) {
    await tx.insert(ventanasCliente).values(entrada.ventanas.map((v) => ({ clienteId, ...v })));
  }
  if (entrada.documentos.length > 0) {
    await tx.insert(documentosCliente).values(entrada.documentos.map((d) => ({ clienteId, ...d })));
  }
}

/** Inserta el cliente con sus ventanas y documentos. No abre transacción: la recibe. */
export async function insertarCliente(tx: Tx, entrada: ClienteEntrada, ahora: Date): Promise<{ id: string; version: number }> {
  const [fila] = await tx
    .insert(clientes)
    .values({ ...columnas(entrada), creadoEn: ahora, actualizadoEn: ahora })
    .returning({ id: clientes.id, version: clientes.version });
  await reemplazarHijos(tx, fila.id, entrada);
  return fila;
}

/**
 * Actualiza solo si la versión guardada es la esperada, en una sola sentencia; sube la versión.
 * Si no actualiza, distingue un cliente inexistente de una versión que cambió.
 */
export async function actualizarClienteSiVersion(
  tx: Tx,
  id: string,
  versionEsperada: number,
  entrada: ClienteEntrada,
  ahora: Date,
): Promise<ResultadoActualizacion> {
  const [fila] = await tx
    .update(clientes)
    .set({ ...columnas(entrada), actualizadoEn: ahora, version: sql`${clientes.version} + 1` })
    .where(and(eq(clientes.id, id), eq(clientes.version, versionEsperada)))
    .returning({ version: clientes.version });
  if (fila) {
    await reemplazarHijos(tx, id, entrada);
    return { estado: "actualizado", version: fila.version };
  }
  const [existe] = await tx.select({ id: clientes.id }).from(clientes).where(eq(clientes.id, id));
  return existe ? { estado: "conflicto" } : { estado: "no_encontrado" };
}

/** Bloquea el renglón del cliente hasta el fin de la transacción. false si no existe. */
export async function bloquearCliente(tx: Tx, id: string): Promise<boolean> {
  const filas = await tx.select({ id: clientes.id }).from(clientes).where(eq(clientes.id, id)).for("update");
  return filas.length > 0;
}

export async function nombresDeCartera(bd: Conexion): Promise<{ id: string; nombre: string }[]> {
  return bd.select({ id: clientes.id, nombre: clientes.nombre }).from(clientes).orderBy(asc(clientes.nombre));
}

/** Clientes con ventanas, documentos y último movimiento de privacidad. Sin ids: toda la cartera. */
async function leerClientes(bd: Conexion, ids?: string[]): Promise<ClienteGuardado[]> {
  const filtroCliente = ids ? inArray(clientes.id, ids) : undefined;
  const filas = await bd.select().from(clientes).where(filtroCliente).orderBy(asc(clientes.nombre), asc(clientes.id));
  if (filas.length === 0) return [];
  const idsLeidos = filas.map((f) => f.id);

  const ventanas = await bd
    .select()
    .from(ventanasCliente)
    .where(inArray(ventanasCliente.clienteId, idsLeidos))
    .orderBy(asc(ventanasCliente.diaSemana), asc(ventanasCliente.horaInicio));
  const documentos = await bd
    .select()
    .from(documentosCliente)
    .where(inArray(documentosCliente.clienteId, idsLeidos))
    .orderBy(asc(documentosCliente.nombre), asc(documentosCliente.id));
  const movimientos = await bd
    .selectDistinctOn([aceptacionesPrivacidad.clienteId])
    .from(aceptacionesPrivacidad)
    .where(inArray(aceptacionesPrivacidad.clienteId, idsLeidos))
    .orderBy(aceptacionesPrivacidad.clienteId, desc(aceptacionesPrivacidad.secuencia));

  const privacidadPorCliente = new Map<string, EstadoPrivacidad>(
    movimientos.map((m) => [m.clienteId, { id: m.id, accion: m.accion, versionAviso: m.versionAviso, medio: m.medio, en: m.en }]),
  );

  return filas.map((c) => ({
    id: c.id,
    version: c.version,
    nombre: c.nombre,
    contactoNombre: c.contactoNombre,
    contactoTelefono: c.contactoTelefono,
    direccion: c.direccion,
    lat: c.lat,
    lng: c.lng,
    tipoResiduo: c.tipoResiduo,
    material: c.material,
    tiposUnidadAdmitidos: c.tiposUnidadAdmitidos,
    notasAcceso: c.notasAcceso,
    tiempoServicioMin: c.tiempoServicioMin,
    cargaEstimadaKg: c.cargaEstimadaKg,
    activo: c.activo,
    ventanas: ventanas
      .filter((v) => v.clienteId === c.id)
      .map((v) => ({ diaSemana: v.diaSemana, horaInicio: hhmm(v.horaInicio), horaFin: hhmm(v.horaFin) })),
    documentos: documentos
      .filter((d) => d.clienteId === c.id)
      .map((d) => ({ nombre: d.nombre, obligatorio: d.obligatorio, estado: d.estado, venceEl: d.venceEl, tipoDocumentoId: d.tipoDocumentoId })),
    privacidad: privacidadPorCliente.get(c.id) ?? null,
  }));
}

/** Clientes de esos ids, con ventanas, documentos y privacidad. */
export async function leerClientesPorId(bd: Conexion, ids: string[]): Promise<ClienteGuardado[]> {
  return ids.length === 0 ? [] : leerClientes(bd, ids);
}

/**
 * Bloquea (FOR SHARE, en orden de id) los renglones de esos clientes hasta el fin de la transacción. Editar un cliente
 * o registrar su privacidad bloquea el mismo renglón (FOR UPDATE), así que no puede cruzarse con la validación del plan.
 */
export async function bloquearClientesCompartido(tx: Tx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.select({ id: clientes.id }).from(clientes).where(inArray(clientes.id, ids)).orderBy(asc(clientes.id)).for("share");
}

export async function leerCliente(bd: Conexion, id: string): Promise<ClienteGuardado | null> {
  const [cliente] = await leerClientes(bd, [id]);
  return cliente ?? null;
}

/** Toda la cartera, ordenada por nombre. Para una lectura coherente, llamarla dentro de una transacción REPEATABLE READ. */
export async function leerCartera(bd: Conexion): Promise<ClienteGuardado[]> {
  return leerClientes(bd);
}
