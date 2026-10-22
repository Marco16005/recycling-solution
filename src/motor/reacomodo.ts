/**
 * Plan 8: reacomodo (fases 2 y 4) y readmisión (fase 3) del motor 1.2.0.
 * Puro y determinista: los presupuestos se cuentan en evaluaciones de ruta, nunca en tiempo de reloj.
 */
import type { EntradaPlan, RutaPlan } from "./tipos";

/** Rutas recalculadas que puede gastar cada fase de reacomodo (§4.4). */
export const PRESUPUESTO_EVALUACIONES = 100_000;
/** Rutas recalculadas que puede gastar "mover una y meter" por cada pospuesta (§4.5). */
export const PRESUPUESTO_READMISION = 20_000;

/**
 * Tiempo muerto por §4.2 de la especificación: por unidad, fin de descarga del último viaje − inicio efectivo
 * − servicios de sus paradas, con inicio efectivo = max(instanteMin, libreDesdeMin, turnoInicioMin). Suma de las unidades.
 */
export function tiempoMuerto(entrada: EntradaPlan, rutas: RutaPlan[]): number {
  void entrada; void rutas;
  throw new Error("pendiente: P8-2");
}
