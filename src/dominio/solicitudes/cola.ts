import { motivosDeBloqueoCliente } from "../clientes/habilitacion";
import type { Cliente } from "../clientes/tipos";
import type { ElementoCola, Solicitud, SolicitudGuardada } from "./tipos";

const MILISEGUNDOS_DIA = 86400000;

function calendario(diasOperacion: number[]): Set<number> {
  if (diasOperacion.length === 0 || diasOperacion.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw new Error("Indica al menos un día de operación entre 0 y 6");
  }
  return new Set(diasOperacion);
}

/** Siguiente fecha de operación estrictamente posterior; calendario sin horas locales. */
export function siguienteDiaOperacion(fecha: string, diasOperacion: number[]): string {
  const dias = calendario(diasOperacion);
  const siguiente = new Date(`${fecha}T00:00:00Z`);
  if (!Number.isFinite(siguiente.getTime())) throw new Error("Fecha de operación no válida");
  do {
    siguiente.setUTCDate(siguiente.getUTCDate() + 1);
  } while (!dias.has(siguiente.getUTCDay()));
  return siguiente.toISOString().slice(0, 10);
}

/** Fecha solicitada excluida, hoy incluido. */
export function diasDeAtraso(s: Pick<Solicitud, "fechaSolicitada">, hoy: string, diasOperacion: number[]): number {
  const dias = calendario(diasOperacion);
  const inicio = new Date(`${s.fechaSolicitada}T00:00:00Z`);
  const fin = new Date(`${hoy}T00:00:00Z`);
  const distancia = Math.max(0, (fin.getTime() - inicio.getTime()) / MILISEGUNDOS_DIA);
  const semanas = Math.floor(distancia / 7);
  let total = semanas * dias.size;
  for (let i = 1; i <= distancia % 7; i++) {
    if (dias.has((inicio.getUTCDay() + i) % 7)) total++;
  }
  return total;
}

/** Orden estable por instante y folio; conserva el arreglo recibido. */
export function ordenFifo<T extends Pick<Solicitud, "registradaEn" | "folio">>(xs: T[]): T[] {
  return [...xs].sort((a, b) => a.registradaEn.getTime() - b.registradaEn.getTime() || (a.folio < b.folio ? -1 : a.folio > b.folio ? 1 : 0));
}

export function cargaEfectivaKg(s: Pick<Solicitud, "cargaEstimadaKg">, cliente: Pick<Cliente, "cargaEstimadaKg">, porOmisionKg: number): number {
  return s.cargaEstimadaKg ?? cliente.cargaEstimadaKg ?? porOmisionKg;
}

/** La consulta selecciona las solicitudes; aquí se clasifican todas las recibidas. */
export function colaDelDia(
  solicitudes: SolicitudGuardada[],
  clientes: Map<string, Cliente>,
  hoy: string,
  versionAviso: string,
  diasOperacion: number[],
  diasParaAtrasada: number,
): ElementoCola[] {
  return ordenFifo(solicitudes).map((solicitud): ElementoCola => {
    const atraso = diasDeAtraso(solicitud, hoy, diasOperacion);
    const base = { solicitud, diasDeAtraso: atraso, atrasada: false, motivos: [] };
    if (solicitud.estado !== "pendiente") return { ...base, estado: "cerrada" };
    if (solicitud.proximaFechaElegible > hoy) return { ...base, estado: "futura" };
    const cliente = clientes.get(solicitud.clienteId);
    // Una referencia ausente es un error del llamador, nunca una solicitud lista.
    if (!cliente) throw new Error("Falta el cliente de una solicitud elegible");
    const motivos = motivosDeBloqueoCliente(cliente, hoy, versionAviso);
    return { ...base, motivos, estado: motivos.length ? "bloqueada" : "lista", atrasada: atraso >= diasParaAtrasada };
  });
}

/** Consecutivo de al menos tres dígitos, sin truncarlo al superar 999. */
export function formatoFolio(fecha: string, consecutivo: number): string {
  if (!Number.isSafeInteger(consecutivo) || consecutivo < 1) throw new Error("El consecutivo debe ser un entero positivo seguro");
  return `S-${fecha.replace(/-/g, "")}-${String(consecutivo).padStart(3, "0")}`;
}
