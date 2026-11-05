import type { Coordenada } from "@/motor";
import { coordenadasDeRuta, leerRuta, pedir, sinBarrasFinales } from "./osrm";

/**
 * Recorrido por calle de cada viaje para dibujarlo en el mapa (Plan 7, §3 y plan §4, hallazgo 4). Solo visual: nunca
 * cambia horas ni km del plan. Si OSRM falla o tarda, el viaje se dibuja en línea recta, como antes del Plan 7.
 *
 * Caché en memoria del proceso con llave versión del mapa | perfil | coordenadas. La versión vigente se aprende de las
 * respuestas de OSRM y, si tiene más de VIGENCIA_VERSION_MS, se renueva con /nearest antes de usar la caché: al cambiar el
 * mapa, los trazos viejos dejan de servirse. Si la sonda falla no se usa la caché (no se sabe qué mapa hay).
 */

/** [lng, lat], como GeoJSON. */
export interface Trazo { coordenadas: [number, number][]; mapa: string | null; recto: boolean }

export interface OpcionesTrazos {
  url: string | undefined;
  fetch?: typeof fetch;
  /** Por petición; 2000 por omisión. */
  plazoMs?: number;
  /** Para toda la llamada; 3000 por omisión. */
  totalMs?: number;
  /** Peticiones a la vez; 4 por omisión. */
  concurrencia?: number;
  /** Milisegundos actuales (pruebas); Date.now por omisión. */
  reloj?: () => number;
}

export const VIGENCIA_VERSION_MS = 60_000;
const MAXIMO_CACHE = 500;
const PLAZO_SONDA_MS = 1000;

const cache = new Map<string, Trazo>();
let version: { valor: string; en: number } | null = null;

export function reiniciarCacheDeTrazos(): void {
  cache.clear();
  version = null;
}

const recto = (puntos: Coordenada[]): Trazo => ({ coordenadas: puntos.map((p) => [p.lng, p.lat]), mapa: null, recto: true });

function guardar(llave: string, trazo: Trazo): void {
  cache.delete(llave);
  cache.set(llave, trazo);
  while (cache.size > MAXIMO_CACHE) cache.delete(cache.keys().next().value!);
}

function leerCache(llave: string): Trazo | undefined {
  const trazo = cache.get(llave);
  if (trazo) guardar(llave, trazo); // LRU: lo usado pasa al final.
  return trazo;
}

async function versionVigente(base: string, f: typeof fetch, punto: Coordenada, ahora: number, plazoMs: number): Promise<string | null> {
  if (version && ahora - version.en < VIGENCIA_VERSION_MS) return version.valor;
  const r = await pedir(f, `${base}/nearest/v1/driving/${coordenadasDeRuta([punto])}`, Math.min(PLAZO_SONDA_MS, plazoMs));
  const valor = r.ok && typeof r.cuerpo.data_version === "string" ? r.cuerpo.data_version : null;
  version = valor === null ? null : { valor, en: ahora };
  return valor;
}

export async function trazosDeViajes(viajes: Coordenada[][], opciones: OpcionesTrazos): Promise<Trazo[]> {
  if (!opciones.url || viajes.length === 0) return viajes.map(recto);
  const base = sinBarrasFinales(opciones.url);
  const f = opciones.fetch ?? fetch;
  const reloj = opciones.reloj ?? Date.now;
  const plazoMs = opciones.plazoMs ?? 2000;
  const fin = performance.now() + (opciones.totalMs ?? 3000);
  const restante = () => Math.max(0, fin - performance.now());

  const primero = viajes.find((v) => v.length > 0)?.[0];
  if (!primero) return viajes.map(recto);
  const vigente = await versionVigente(base, f, primero, reloj(), Math.min(plazoMs, restante()));
  if (vigente === null) return viajes.map(recto);

  const resultado: Trazo[] = viajes.map(recto);
  let siguiente = 0;
  async function trabajar(): Promise<void> {
    while (siguiente < viajes.length) {
      const i = siguiente++;
      const puntos = viajes[i];
      if (puntos.length < 2) continue;
      const llave = `${vigente}|car|${coordenadasDeRuta(puntos)}`;
      const guardado = leerCache(llave);
      if (guardado) { resultado[i] = guardado; continue; }
      const tiempo = Math.min(plazoMs, restante());
      if (tiempo <= 0) continue;
      const r = await pedir(f, `${base}/route/v1/driving/${coordenadasDeRuta(puntos)}?overview=simplified&geometries=geojson`, tiempo);
      if (!r.ok) continue;
      const ruta = leerRuta(r.cuerpo);
      if (!ruta) continue;
      const trazo: Trazo = { coordenadas: ruta.coordenadas, mapa: ruta.version ?? vigente, recto: false };
      resultado[i] = trazo;
      guardar(`${trazo.mapa}|car|${coordenadasDeRuta(puntos)}`, trazo);
    }
  }
  // Un plazo total vence aunque una petición siga colgada: se espera lo que termine antes y el resto queda recto.
  const trabajadores = Array.from({ length: Math.min(opciones.concurrencia ?? 4, viajes.length) }, trabajar);
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<void>((r) => { temporizador = setTimeout(r, restante()); });
  await Promise.race([Promise.all(trabajadores), limite]);
  clearTimeout(temporizador);
  return resultado.map((t) => ({ ...t, coordenadas: [...t.coordenadas] }));
}
