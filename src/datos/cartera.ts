import { and, desc, eq, inArray, max } from "drizzle-orm";
import type { BD, Tx } from "./bd";
import { jornadas, notasCliente, paradas, rutas, solicitudes, unidades, usuarios } from "./esquema";

/** Plan CRM: lecturas de la ficha, las propuestas y la exportación. */
type Conexion = BD | Tx;

export async function solicitudesDeCliente(bd: Conexion, clienteId: string) {
  return bd.select({ id: solicitudes.id, folio: solicitudes.folio, fechaSolicitada: solicitudes.fechaSolicitada, canal: solicitudes.canal,
    estado: solicitudes.estado, motivoCancelacion: solicitudes.motivoCancelacion, vecesPospuesta: solicitudes.vecesPospuesta })
    .from(solicitudes).where(eq(solicitudes.clienteId, clienteId)).orderBy(desc(solicitudes.fechaSolicitada), desc(solicitudes.folio));
}

/** Paradas cerradas (completadas o no atendidas) del cliente, con la fecha de la jornada y la placa. */
export async function recoleccionesDeCliente(bd: Conexion, clienteId: string) {
  return bd.select({ fecha: jornadas.fecha, placa: unidades.placa, estado: paradas.estado, llegadaEn: paradas.llegadaEn,
    inicioServicioEn: paradas.inicioServicioEn, ventanaInicio: paradas.ventanaInicio, ventanaFin: paradas.ventanaFin,
    motivoNoAtendida: paradas.motivoNoAtendida })
    .from(paradas)
    .innerJoin(solicitudes, eq(solicitudes.id, paradas.solicitudId))
    .innerJoin(rutas, eq(rutas.id, paradas.rutaId))
    .innerJoin(jornadas, eq(jornadas.id, rutas.jornadaId))
    .innerJoin(unidades, eq(unidades.id, jornadas.unidadId))
    .where(and(eq(solicitudes.clienteId, clienteId), inArray(paradas.estado, ["completada", "no_atendida"])))
    .orderBy(desc(jornadas.fecha), desc(paradas.cierreEn));
}

/** Notas con el nombre de su autor, más recientes primero. */
export async function notasConAutor(bd: Conexion, clienteId: string) {
  return bd.select({ id: notasCliente.id, tipo: notasCliente.tipo, texto: notasCliente.texto, en: notasCliente.en,
    corrigeA: notasCliente.corrigeA, autor: usuarios.nombre })
    .from(notasCliente).innerJoin(usuarios, eq(usuarios.id, notasCliente.autor))
    .where(eq(notasCliente.clienteId, clienteId)).orderBy(desc(notasCliente.en), desc(notasCliente.id));
}

/** Por cliente: fechas solicitadas de sus solicitudes atendidas (para el ritmo). */
export async function fechasAtendidas(bd: Conexion, clienteIds: string[]): Promise<Map<string, string[]>> {
  const salida = new Map<string, string[]>();
  if (!clienteIds.length) return salida;
  const filas = await bd.select({ clienteId: solicitudes.clienteId, fecha: solicitudes.fechaSolicitada }).from(solicitudes)
    .where(and(inArray(solicitudes.clienteId, clienteIds), eq(solicitudes.estado, "atendida")));
  for (const f of filas) salida.set(f.clienteId, [...(salida.get(f.clienteId) ?? []), f.fecha]);
  return salida;
}

/** Clientes con una solicitud pendiente, programada o en ruta. */
export async function conSolicitudAbierta(bd: Conexion, clienteIds: string[]): Promise<Set<string>> {
  if (!clienteIds.length) return new Set();
  const filas = await bd.selectDistinct({ clienteId: solicitudes.clienteId }).from(solicitudes)
    .where(and(inArray(solicitudes.clienteId, clienteIds), inArray(solicitudes.estado, ["pendiente", "programada", "en_ruta"])));
  return new Set(filas.map((f) => f.clienteId));
}

/** Fecha solicitada más reciente de cada cliente, en cualquier estado. */
export async function ultimaSolicitud(bd: Conexion, clienteIds: string[]): Promise<Map<string, string>> {
  if (!clienteIds.length) return new Map();
  const filas = await bd.select({ clienteId: solicitudes.clienteId, fecha: max(solicitudes.fechaSolicitada) }).from(solicitudes)
    .where(inArray(solicitudes.clienteId, clienteIds)).groupBy(solicitudes.clienteId);
  return new Map(filas.filter((f) => f.fecha !== null).map((f) => [f.clienteId, f.fecha!]));
}

