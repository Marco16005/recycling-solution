/**
 * Contrato del Plan 6, §3 (docs/superpowers/plans/2026-10-15-plan-6-indicadores-y-panel.md). Entradas planas que arma la
 * consulta; las funciones de src/indicadores son puras. Transcrito por Claude del plan acordado; lo mantiene Codex.
 */

/** La parada anterior en la secuencia del viaje: si es la primera, el traslado se mide desde la salida del patio. */
export type Anterior = { tipo: "primera"; salidaPatioEn: Date | null } | { tipo: "anterior"; cierreEn: Date | null };

export interface RecoleccionMedida {
  fecha: string;
  folio: string;
  cliente: string;
  placa: string;
  viajeId: string;
  numeroViajeEnJornada: number;
  estado: "completada" | "no_atendida";
  asignadaEn: Date;
  disponibleParaSalirEn: Date;
  llegadaEn: Date | null;
  inicioServicioEn: Date | null;
  finServicioEn: Date | null;
  /** "HH:MM" */
  ventanaInicio: string;
  ventanaFin: string;
  anterior: Anterior;
  /** Para prorratear espera y regreso más descarga. */
  completadasDelViaje: number;
  /** Del viaje: descarga_fin_en − cierre_en de su última parada, en minutos. */
  regresoMasDescargaMin: number | null;
  kmContrafactual: number;
}

export interface ViajeMedido {
  viajeId: string;
  odometroInicioKm: number | null;
  odometroFinKm: number | null;
  rendimientoKmL: number;
  kmContrafactualCompletadas: number;
}

export interface ConteosK3 { noAtendidas: number; omitidas: number; pendientesAlCierre: number }

export interface Medida { valor: number | null; muestra: number; lineaBase?: number }
