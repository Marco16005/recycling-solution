import type { Cliente } from "../clientes/tipos";
import type { ElementoCola, Solicitud, SolicitudGuardada } from "./tipos";

/** Siguiente fecha de operación estrictamente posterior a fecha. diasOperacion: 0 = domingo … 6 = sábado. */
export function siguienteDiaOperacion(fecha: string, diasOperacion: number[]): string {
  void fecha;
  void diasOperacion;
  throw new Error("pendiente: Plan 2 T2 (Codex)");
}

/** Días de operación entre la fecha solicitada (excluida) y hoy (incluido); 0 si hoy no es posterior. */
export function diasDeAtraso(s: Pick<Solicitud, "fechaSolicitada">, hoy: string, diasOperacion: number[]): number {
  void s;
  void hoy;
  void diasOperacion;
  throw new Error("pendiente: Plan 2 T2 (Codex)");
}

/** Orden FIFO estable: registradaEn, luego folio. No modifica el arreglo recibido. */
export function ordenFifo<T extends Pick<Solicitud, "registradaEn" | "folio">>(xs: T[]): T[] {
  void xs;
  throw new Error("pendiente: Plan 2 T2 (Codex)");
}

/** Carga a usar: la de la solicitud, la del cliente o la de configuración, en ese orden. */
export function cargaEfectivaKg(s: Pick<Solicitud, "cargaEstimadaKg">, cliente: Pick<Cliente, "cargaEstimadaKg">, porOmisionKg: number): number {
  void s;
  void cliente;
  void porOmisionKg;
  throw new Error("pendiente: Plan 2 T2 (Codex)");
}

/**
 * Cola del día en orden FIFO. cerrada si el estado no es pendiente; futura si proximaFechaElegible > hoy;
 * bloqueada si motivosDeBloqueoCliente(cliente, hoy, versionAviso) no está vacía; lista en otro caso.
 * atrasada = diasDeAtraso ≥ diasParaAtrasada (solo listas y bloqueadas).
 */
export function colaDelDia(
  solicitudes: SolicitudGuardada[],
  clientes: Map<string, Cliente>,
  hoy: string,
  versionAviso: string,
  diasOperacion: number[],
  diasParaAtrasada: number,
): ElementoCola[] {
  void solicitudes;
  void clientes;
  void hoy;
  void versionAviso;
  void diasOperacion;
  void diasParaAtrasada;
  throw new Error("pendiente: Plan 2 T2 (Codex)");
}

/** S-AAAAMMDD-NNN; el consecutivo usa al menos 3 dígitos y más si hace falta (S-20261014-1000). */
export function formatoFolio(fecha: string, consecutivo: number): string {
  void fecha;
  void consecutivo;
  throw new Error("pendiente: Plan 2 T2 (Codex)");
}
