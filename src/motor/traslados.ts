import { distanciaKm } from "./geometria";
import { ErrorTraslados } from "./tipos";
import type { Coordenada, EntradaPlan, FranjaPico, Traslados } from "./tipos";

export const VERSION_MOTOR = "1.2.0";
const clave = (p: Coordenada) => `${p.lat}|${p.lng}`;

/** null si son válidas; la configuración admite minutos de 00:00 a 23:59. */
export function validarFranjas(franjas: FranjaPico[]): string | null {
  const orden = [...franjas].sort((a, b) => a.inicioMin - b.inicioMin);
  for (const [i, f] of orden.entries()) {
    if (!Number.isInteger(f.inicioMin) || !Number.isInteger(f.finMin)
      || f.inicioMin < 0 || f.finMin > 1439 || f.inicioMin >= f.finMin)
      return "Cada franja debe empezar antes de terminar, entre 00:00 y 23:59";
    if (!Number.isFinite(f.factor) || f.factor < 1 || f.factor > 3) return "El factor debe estar entre 1 y 3";
    if (i > 0 && orden[i - 1].finMin > f.inicioMin) return "Las franjas no deben traslaparse";
  }
  return null;
}

/** Las franjas ya están ordenadas y validadas por evaluación. */
function llegada(salida: number, minutos: number, orden: FranjaPico[]): number {
  if (!orden.length) return salida + Math.ceil(minutos);
  let t = salida, restante = minutos;
  for (const f of orden) {
    if (t >= f.finMin) continue;
    if (t < f.inicioMin) {
      const libres = f.inicioMin - t;
      if (restante <= libres) return Math.ceil(t + restante - 1e-9);
      restante -= libres;
      t = f.inicioMin;
    }
    const libres = (f.finMin - t) / f.factor;
    if (restante <= libres) return Math.ceil(t + restante * f.factor - 1e-9);
    restante -= libres;
    t = f.finMin;
  }
  return Math.ceil(t + restante - 1e-9);
}

export function llegadaConHorasPico(salidaMin: number, minLibres: number, franjas: FranjaPico[] | undefined): number {
  if (validarFranjas(franjas ?? [])) throw new ErrorTraslados("franjas_invalidas");
  return llegada(salidaMin, minLibres, [...(franjas ?? [])].sort((a, b) => a.inicioMin - b.inicioMin));
}

/** Valida la matriz y construye una sola vez el índice de identidad exacta. */
export function crearTraslados(entrada: EntradaPlan): Traslados {
  const p = entrada.parametros;
  if (validarFranjas(p.horasPico ?? [])) throw new ErrorTraslados("franjas_invalidas");
  const orden = [...(p.horasPico ?? [])].sort((a, b) => a.inicioMin - b.inicioMin);
  const m = entrada.traslados;
  const indice = new Map<string, number>();
  if (m) {
    const n = m.puntos.length;
    const numero = (v: number) => Number.isFinite(v) && v >= 0;
    if (m.puntos.some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lng)
      || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180)
      || new Set(m.puntos.map(clave)).size !== n
      || [m.km, m.minLibres].some(matriz => matriz.length !== n || matriz.some((fila, i) =>
        fila.length !== n || fila.some(v => !numero(v)) || fila[i] !== 0))
      || m.ajusteM.length !== n || m.ajusteM.some(v => !numero(v))
      || m.aproximados.some(par => par.length !== 2 || par.some(i => !Number.isInteger(i) || i < 0 || i >= n))
      || typeof m.mapa !== "string") throw new ErrorTraslados("matriz_invalida");
    m.puntos.forEach((p, i) => indice.set(clave(p), i));
    for (const punto of [p.patio, ...entrada.solicitudes.map(s => s.ubicacion), ...entrada.unidades.map(u => u.ubicacionInicial)])
      if (!indice.has(clave(punto))) throw new ErrorTraslados("punto_faltante");
  }
  const tramo: Traslados["tramo"] = (a, b) => {
    if (!m) {
      const km = distanciaKm(a, b, p.factorCircuidad);
      return { km, minLibres: km * 60 / p.velocidadKmh };
    }
    const i = indice.get(clave(a)), j = indice.get(clave(b));
    if (i === undefined || j === undefined) throw new ErrorTraslados("punto_faltante");
    return { km: m.km[i][j], minLibres: m.minLibres[i][j] };
  };
  return { tramo, llegada: (a, b, s) => llegada(s, tramo(a, b).minLibres, orden) };
}
