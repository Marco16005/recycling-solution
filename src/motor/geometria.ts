import type { Coordenada } from "./tipos";

/** Radio terrestre medio IUGG; haversine, con protección en las antípodas. */
export function distanciaKm(a: Coordenada, b: Coordenada, factorCircuidad: number): number {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h)))) * factorCircuidad;
}

export function minutosDeTraslado(km: number, velocidadKmh: number): number {
  return Math.ceil(km * 60 / velocidadKmh);
}
