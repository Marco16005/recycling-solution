import type { Coordenada } from "@/motor";

/** Peticiones a OSRM y comprobación de la forma de sus respuestas (Plan 7, P7-5). */

export type FallaOsrm = "sin_respuesta" | "respuesta_invalida" | "error_osrm";
export type Respuesta = { ok: true; cuerpo: Record<string, unknown> } | { ok: false; falla: FallaOsrm };

export const coordenadasDeRuta = (puntos: Coordenada[]) => puntos.map((p) => `${p.lng},${p.lat}`).join(";");

/** GET con plazo. Sin respuesta (red o plazo), cuerpo que no es JSON, o JSON con un code distinto de "Ok". */
export async function pedir(f: typeof fetch, url: string, plazoMs: number): Promise<Respuesta> {
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), plazoMs);
  let texto: string;
  try {
    const respuesta = await f(url, { signal: control.signal });
    texto = await respuesta.text();
  } catch {
    return { ok: false, falla: "sin_respuesta" };
  } finally {
    clearTimeout(temporizador);
  }
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    return { ok: false, falla: "respuesta_invalida" };
  }
  if (typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) return { ok: false, falla: "respuesta_invalida" };
  const c = cuerpo as Record<string, unknown>;
  if (typeof c.code !== "string") return { ok: false, falla: "respuesta_invalida" };
  if (c.code !== "Ok") return { ok: false, falla: "error_osrm" };
  return { ok: true, cuerpo: c };
}

const numeroONulo = (x: unknown) => x === null || (typeof x === "number" && Number.isFinite(x) && x >= 0);
const esMatriz = (x: unknown, n: number): x is (number | null)[][] =>
  Array.isArray(x) && x.length === n && x.every((fila) => Array.isArray(fila) && fila.length === n && fila.every(numeroONulo));

export interface Tabla { distancias: (number | null)[][]; duraciones: (number | null)[][]; ajusteM: number[]; version: string | null }

/** La respuesta de /table con n puntos, o null si no tiene la forma esperada. */
export function leerTabla(c: Record<string, unknown>, n: number): Tabla | null {
  const fuentes = c.sources;
  if (!esMatriz(c.distances, n) || !esMatriz(c.durations, n) || !Array.isArray(fuentes) || fuentes.length !== n) return null;
  const ajusteM = fuentes.map((s) => (typeof s === "object" && s !== null ? (s as { distance?: unknown }).distance : undefined));
  if (!ajusteM.every((d): d is number => typeof d === "number" && Number.isFinite(d) && d >= 0)) return null;
  return { distancias: c.distances, duraciones: c.durations, ajusteM, version: typeof c.data_version === "string" ? c.data_version : null };
}

/** /nearest de un solo punto como una tabla de 1 × 1, o null. */
export function leerCercano(c: Record<string, unknown>): Tabla | null {
  const puntos = c.waypoints;
  const distancia = Array.isArray(puntos) ? (puntos[0] as { distance?: unknown } | undefined)?.distance : undefined;
  if (typeof distancia !== "number" || !Number.isFinite(distancia) || distancia < 0) return null;
  return { distancias: [[0]], duraciones: [[0]], ajusteM: [distancia], version: typeof c.data_version === "string" ? c.data_version : null };
}

/** La geometría de /route ([lng, lat]) o null. */
export function leerRuta(c: Record<string, unknown>): { coordenadas: [number, number][]; version: string | null } | null {
  const rutas = c.routes;
  const geometria = Array.isArray(rutas) ? (rutas[0] as { geometry?: { coordinates?: unknown } } | undefined)?.geometry : undefined;
  const coordenadas = geometria?.coordinates;
  if (!Array.isArray(coordenadas) || coordenadas.length < 2) return null;
  if (!coordenadas.every((p) => Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every((x) => typeof x === "number" && Number.isFinite(x)))) return null;
  return { coordenadas: coordenadas.map((p) => [p[0], p[1]] as [number, number]), version: typeof c.data_version === "string" ? c.data_version : null };
}

/** La URL base sin barras finales. Sin expresión regular: «/+$» retrocede de forma cuadrática con muchas barras (SonarQube S8786). */
export function sinBarrasFinales(url: string): string {
  let fin = url.length;
  while (fin > 0 && url[fin - 1] === "/") fin--;
  return url.slice(0, fin);
}
