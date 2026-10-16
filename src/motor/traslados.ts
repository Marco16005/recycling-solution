import type { EntradaPlan, FranjaPico, Traslados } from "./tipos";

/** Plan 7, §2.1. Lo implementa Codex en P7-2; hasta entonces lanza. */

export const VERSION_MOTOR = "1.1.0";

/** Arma el índice coordenada → fila una sola vez por evaluación. Sin matriz: fórmula anterior. */
export function crearTraslados(entrada: EntradaPlan): Traslados {
  void entrada;
  throw new Error("pendiente: P7-2");
}

/** §4.2: modelo continuo por franjas; sin franjas, salidaMin + Math.ceil(minLibres). */
export function llegadaConHorasPico(salidaMin: number, minLibres: number, franjas: FranjaPico[] | undefined): number {
  void salidaMin; void minLibres; void franjas;
  throw new Error("pendiente: P7-2");
}

/** null si son válidas; si no, el texto del problema. */
export function validarFranjas(franjas: FranjaPico[]): string | null {
  void franjas;
  throw new Error("pendiente: P7-2");
}
