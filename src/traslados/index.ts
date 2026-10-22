import type { InfoTraslados, MotivoAproximado } from "@/dominio/plan/tipos";
import { distanciaKm, type Coordenada, type EntradaPlan, type MatrizTraslados } from "@/motor";
import { coordenadasDeRuta, leerCercano, leerTabla, pedir } from "./osrm";

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
  const vistos = new Set<string>();
  const puntos: Coordenada[] = [];
  for (const p of [entrada.parametros.patio, ...entrada.solicitudes.map((s) => s.ubicacion), ...entrada.unidades.map((u) => u.ubicacionInicial)]) {
    const llave = `${p.lat}|${p.lng}`;
    if (vistos.has(llave)) continue;
    vistos.add(llave);
    puntos.push({ lat: p.lat, lng: p.lng });
  }
  return puntos;
}

const aproximado = (motivo: MotivoAproximado, consultaMs: number | null): ResultadoMatriz =>
  ({ matriz: null, info: { fuente: "aproximado", motivo, mapa: null, paresAproximados: 0 }, consultaMs });

/**
 * Matriz dirigida por calle desde OSRM /table. Sin URL, con demasiados puntos o con una falla de la petición completa, no
 * hay matriz y el motor usa la fórmula anterior; el motivo queda en info. Una celda sin ruta (calles desconectadas) se
 * llena con la fórmula anterior, sin factor de camión, y queda en aproximados.
 */
export async function matrizDeTraslados(puntos: Coordenada[], opciones: OpcionesOsrm): Promise<ResultadoMatriz> {
  if (!opciones.url) return aproximado("sin_configurar", null);
  if (puntos.length > LIMITE_PUNTOS) return aproximado("demasiados_puntos", null);
  const inicio = performance.now();
  const base = opciones.url.replace(/\/+$/, "");
  // /table exige al menos dos coordenadas; con un solo punto (el patio de un plan vacío) basta saber su ajuste y el mapa.
  const url = puntos.length === 1
    ? `${base}/nearest/v1/driving/${coordenadasDeRuta(puntos)}`
    : `${base}/table/v1/driving/${coordenadasDeRuta(puntos)}?annotations=distance,duration`;
  const respuesta = await pedir(opciones.fetch ?? fetch, url, opciones.plazoMs ?? 5000);
  const consultaMs = performance.now() - inicio;
  if (!respuesta.ok) return aproximado(respuesta.falla, consultaMs);
  const tabla = puntos.length === 1 ? leerCercano(respuesta.cuerpo) : leerTabla(respuesta.cuerpo, puntos.length);
  if (tabla === null) return aproximado("respuesta_invalida", consultaMs);

  const { velocidadKmh, factorCircuidad } = opciones.respaldo;
  const n = puntos.length;
  const km: number[][] = [], minLibres: number[][] = [], aproximados: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    km.push([]); minLibres.push([]);
    for (let j = 0; j < n; j++) {
      const metros = tabla.distancias[i][j], segundos = tabla.duraciones[i][j];
      if (i === j) { km[i].push(0); minLibres[i].push(0); continue; }
      if (metros === null || segundos === null) {
        // Misma expresión que el motor sin matriz (Plan 7, §2.1).
        const k = distanciaKm(puntos[i], puntos[j], factorCircuidad);
        km[i].push(k); minLibres[i].push((k * 60) / velocidadKmh);
        aproximados.push([i, j]);
        continue;
      }
      km[i].push(metros / 1000);
      minLibres[i].push((segundos / 60) * opciones.factorCamion);
    }
  }
  const mapa = tabla.version ?? "desconocido";
  return {
    matriz: { puntos: puntos.map((p) => ({ lat: p.lat, lng: p.lng })), km, minLibres, ajusteM: tabla.ajusteM, aproximados, mapa },
    info: { fuente: "osrm", motivo: null, mapa, paresAproximados: aproximados.length },
    consultaMs,
  };
}

/** Agrega la matriz a la entrada (si la hay). */
export function conTraslados(entrada: EntradaPlan, r: ResultadoMatriz): EntradaPlan {
  return r.matriz ? { ...entrada, traslados: r.matriz } : entrada;
}

export { reiniciarCacheDeTrazos, trazosDeViajes, type Trazo } from "./trazos";

/** Plan CRM, §4.2: metros del punto a la calle más cercana según OSRM (/nearest); null sin OSRM o si falla. */
export async function distanciaACalle(punto: Coordenada, opciones: { url: string | undefined; fetch?: typeof fetch; plazoMs?: number }): Promise<number | null> {
  if (!opciones.url) return null;
  const r = await pedir(opciones.fetch ?? fetch, `${opciones.url.replace(/\/+$/, "")}/nearest/v1/driving/${coordenadasDeRuta([punto])}`, opciones.plazoMs ?? 2000);
  if (!r.ok) return null;
  return leerCercano(r.cuerpo)?.ajusteM[0] ?? null;
}
