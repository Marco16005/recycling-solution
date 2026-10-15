import type { Efecto, EstadoJornada, EventoEntrada } from "./tipos";

export type * from "./tipos";

/** Pura. recibidoEn es la hora del servidor. Implementación pendiente de R1. */
export function aplicarEvento(estado: EstadoJornada, evento: EventoEntrada, recibidoEn: string):
  | { ok: true; efectos: Efecto[] } | { ok: false; motivo: string } {
  throw new Error("pendiente");
}

/** Huella canónica con claves ordenadas, jornada incluida y sin recibidoEn. Pendiente de R1. */
export function huellaEvento(evento: EventoEntrada): string {
  throw new Error("pendiente");
}

/**
 * Frontera del re-ruteo; ids de solicitudes. Pendiente de R1.
 * ahora es ISO; libreDesdeMin se expresa en minutos de Ciudad de México.
 * Retraso: real menos estimado del último hito del viaje en curso, con mínimo cero.
 * Para el cierre de una no atendida se usa su llegada estimada.
 */
export function fronteraDeReruteo(estado: EstadoJornada, disponible: boolean, ahora: string):
  | { ok: true; congeladas: string[]; viajeEnCurso: string | null; retrasoMin: number; libreDesdeMin: number;
      admitidas: string[][]; aReubicar: string[] }
  | { ok: false; motivo: string } {
  throw new Error("pendiente");
}
