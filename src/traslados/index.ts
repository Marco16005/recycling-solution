import type { InfoTraslados } from "@/dominio/plan/tipos";
import type { Coordenada, EntradaPlan, MatrizTraslados } from "@/motor";

/**
 * Traslados por calle con OSRM (Plan 7, §2.4). Fuera del motor: aquí sí hay red. Lo implementa Claude en P7-5.
 * Ninguna petición sale de la instalación: OSRM corre en su propio contenedor.
 */

export const LIMITE_PUNTOS = 400;
export const UMBRAL_PIN_M = 300;

export interface OpcionesOsrm {
  /** process.env.OSRM_URL; vacío o ausente = "sin_configurar". */
  url: string | undefined;
  factorCamion: number;
  /** Para celdas nulas: la fórmula anterior. */
  respaldo: { velocidadKmh: number; factorCircuidad: number };
  fetch?: typeof fetch;
  plazoMs?: number;
}
export interface ResultadoMatriz { matriz: MatrizTraslados | null; info: InfoTraslados; consultaMs: number | null }

/** Patio, ubicaciones de solicitudes y ubicación inicial de unidades, sin repetir (identidad exacta), en ese orden. */
export function puntosDeEntrada(entrada: EntradaPlan): Coordenada[] {
  void entrada;
  throw new Error("pendiente: P7-5");
}

export async function matrizDeTraslados(puntos: Coordenada[], opciones: OpcionesOsrm): Promise<ResultadoMatriz> {
  void puntos; void opciones;
  throw new Error("pendiente: P7-5");
}

/** Agrega la matriz a la entrada (si la hay). */
export function conTraslados(entrada: EntradaPlan, r: ResultadoMatriz): EntradaPlan {
  return r.matriz ? { ...entrada, traslados: r.matriz } : entrada;
}

/** [lng, lat], como GeoJSON. */
export interface Trazo { coordenadas: [number, number][]; mapa: string | null; recto: boolean }

export async function trazosDeViajes(viajes: Coordenada[][], opciones: {
  url: string | undefined; fetch?: typeof fetch; plazoMs?: number; totalMs?: number; concurrencia?: number;
}): Promise<Trazo[]> {
  void opciones;
  return viajes.map((puntos) => ({ coordenadas: puntos.map((p) => [p.lng, p.lat]), mapa: null, recto: true }));
}
