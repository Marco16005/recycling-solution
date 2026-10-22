import type { ConteosK3, Medida, RecoleccionMedida, ViajeMedido } from "./tipos";

export type * from "./tipos";

/**
 * Indicadores del Plan 6 (§2), puros. Minutos para tiempos, kilómetros y litros para distancias; los porcentajes
 * (K3, K4 ahorro y K5) van de 0 a 100. Un dato faltante excluye la recolección de ese indicador y la muestra lo refleja.
 */

const minutos = (a: Date, b: Date) => (a.getTime() - b.getTime()) / 60_000;

function media(xs: number[]): Medida {
  return { valor: xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length, muestra: xs.length };
}

function mediana(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 === 1 ? o[m] : (o[m - 1] + o[m]) / 2;
}

const porciento = (parte: number, total: number) => (total === 0 ? null : (parte / total) * 100);

const reloj = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
/** Minuto del día en Ciudad de México, con fracción de segundos. */
function minutoDelDia(instante: Date): number {
  const p = Object.fromEntries(reloj.formatToParts(instante).filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)]));
  return p.hour * 60 + p.minute + p.second / 60;
}
const minutoDeHora = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const completadas = (r: RecoleccionMedida[]) => r.filter((x) => x.estado === "completada");

/** Espera prorrateada de una recolección: la espera del viaje entre sus completadas. */
function espera(x: RecoleccionMedida): number {
  return Math.max(0, minutos(x.asignadaEn, x.disponibleParaSalirEn)) / Math.max(1, x.completadasDelViaje);
}

/** Traslado hasta la parada: desde la salida del patio si es la primera, o desde el cierre de la anterior. null si falta. */
function traslado(x: RecoleccionMedida): number | null {
  const desde = x.anterior.tipo === "primera" ? x.anterior.salidaPatioEn : x.anterior.cierreEn;
  return x.llegadaEn && desde ? minutos(x.llegadaEn, desde) : null;
}

export function k1(r: RecoleccionMedida[]): { espera: Medida; traslado: Medida } {
  const c = completadas(r);
  return {
    espera: media(c.map(espera)),
    traslado: media(c.map(traslado).filter((t): t is number => t !== null)),
  };
}

export function k2(capturasSeg: number[], lineaBaseSeg: number | null): Medida {
  return { valor: mediana(capturasSeg), muestra: capturasSeg.length, ...(lineaBaseSeg !== null ? { lineaBase: lineaBaseSeg } : {}) };
}

/**
 * Dentro de la ventana: ventana_inicio ≤ inicio del servicio ≤ ventana_fin, con segundos (Plan 6 §2). Llegar antes y
 * esperar cuenta; empezar antes de que abra o después del cierre exacto (09:00:01 para una ventana que cierra a las 09:00), no.
 */
function dentroDeVentana(x: RecoleccionMedida): boolean | null {
  if (!x.inicioServicioEn) return null;
  const m = minutoDelDia(x.inicioServicioEn);
  return minutoDeHora(x.ventanaInicio) <= m && m <= minutoDeHora(x.ventanaFin);
}

export function k3(r: RecoleccionMedida[], conteos: ConteosK3): Medida & ConteosK3 {
  const evaluables = completadas(r).map(dentroDeVentana).filter((d): d is boolean => d !== null);
  return { valor: porciento(evaluables.filter(Boolean).length, evaluables.length), muestra: evaluables.length, ...conteos };
}

export function k4(v: ViajeMedido[], simulado: { km: number; kmMetodoActual: number }[]): {
  kmReales: Medida; kmContrafactual: number; litros: number | null; ahorroObservado: Medida; ahorroSimulado: Medida;
} {
  const medidos = v.filter((x) => x.odometroInicioKm !== null && x.odometroFinKm !== null);
  const km = medidos.map((x) => x.odometroFinKm! - x.odometroInicioKm!);
  const kmReales = km.reduce((s, x) => s + x, 0);
  const kmContrafactual = medidos.reduce((s, x) => s + x.kmContrafactualCompletadas, 0);
  const litros = medidos.length === 0 ? null : medidos.reduce((s, x, i) => s + km[i] / x.rendimientoKmL, 0);
  const actual = simulado.reduce((s, x) => s + x.kmMetodoActual, 0);
  const propuesto = simulado.reduce((s, x) => s + x.km, 0);
  return {
    kmReales: { valor: medidos.length === 0 ? null : kmReales, muestra: medidos.length },
    kmContrafactual,
    litros,
    ahorroObservado: { valor: porciento(kmContrafactual - kmReales, kmContrafactual), muestra: medidos.length },
    ahorroSimulado: { valor: porciento(actual - propuesto, actual), muestra: simulado.length },
  };
}

export function k5(
  actual: { activos: number; completos: number },
  serie: { fecha: string; activos: number; completos: number }[],
): Medida & { serie: { fecha: string; valor: number }[] } {
  return {
    valor: porciento(actual.completos, actual.activos),
    muestra: actual.activos,
    serie: serie.filter((x) => x.activos > 0).map((x) => ({ fecha: x.fecha, valor: (x.completos / x.activos) * 100 })),
  };
}

export function k6(planes: { tipo: "inicial" | "re_ruteo"; generadoEn: Date; revisionIniciadaEn: Date | null; validadoEn: Date }[]):
  Record<"inicial" | "re_ruteo", { demora: Medida; trabajoActivo: Medida }> & { metaMin: 5 } {
  const de = (tipo: "inicial" | "re_ruteo") => {
    const ps = planes.filter((p) => p.tipo === tipo);
    return {
      demora: media(ps.map((p) => minutos(p.validadoEn, p.generadoEn))),
      trabajoActivo: media(ps.filter((p) => p.revisionIniciadaEn !== null).map((p) => minutos(p.validadoEn, p.revisionIniciadaEn!))),
    };
  };
  return { inicial: de("inicial"), re_ruteo: de("re_ruteo"), metaMin: 5 };
}

export function k7(e: { duracionMs: number; resultado: "ok" | "error" | "tiempo_agotado" }[]): {
  mediana: Medida; maximo: number | null; errores: number; agotadas: number;
} {
  const ok = e.filter((x) => x.resultado === "ok").map((x) => x.duracionMs);
  return {
    mediana: { valor: mediana(ok), muestra: ok.length },
    maximo: ok.length === 0 ? null : Math.max(...ok),
    errores: e.filter((x) => x.resultado === "error").length,
    agotadas: e.filter((x) => x.resultado === "tiempo_agotado").length,
  };
}

/** Ciclo de una recolección completada; null si falta algún tramo. */
function cicloDe(x: RecoleccionMedida): number | null {
  const t = traslado(x);
  if (x.estado !== "completada" || t === null || !x.llegadaEn || !x.finServicioEn || x.regresoMasDescargaMin === null) return null;
  return espera(x) + t + minutos(x.finServicioEn, x.llegadaEn) + x.regresoMasDescargaMin / Math.max(1, x.completadasDelViaje);
}

export function ciclo(r: RecoleccionMedida[]): Medida {
  return media(r.map(cicloDe).filter((c): c is number => c !== null));
}

const ENCABEZADOS = [
  "fecha", "folio", "cliente", "placa", "viaje", "estado", "espera_min", "traslado_min", "servicio_min",
  "regreso_y_descarga_min", "ciclo_min", "dentro_de_ventana", "km_contrafactual",
];

/**
 * Un texto que empieza como fórmula (=, +, -, @, tabulador o retorno) se neutraliza con un apóstrofo: Excel no lo ejecuta.
 * Un número puro (-100.3, +5) no es fórmula y se deja tal cual, para que la cartera exportada se vuelva a importar (Plan CRM).
 */
const NUMERO_PURO = /^[+-]?\d+(\.\d+)?$/;
const sinFormula = (v: string) => (/^[=+\-@\t\r]/.test(v) && !NUMERO_PURO.test(v) ? `'${v}` : v);

/** Celda de CSV para Excel: fórmulas neutralizadas y comillas cuando hace falta. Los números se redondean a 2 decimales. */
export function celda(v: string | number | boolean | null): string {
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "si" : "no";
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "";
  const texto = sinFormula(v);
  return /[",\r\n]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
}

/** Documento CSV para Excel: UTF-8 con BOM, comas y CRLF (también lo usa la cartera, Plan CRM). */
export function documentoCsv(encabezados: readonly string[], filas: (string | number | boolean | null)[][]): string {
  return `\uFEFF${[encabezados.join(","), ...filas.map((f) => f.map(celda).join(","))].join("\r\n")}\r\n`;
}

/** CSV para Excel: UTF-8 con BOM, comas, punto decimal y CRLF. Celdas vacías para lo que falta. */
export function csv(r: RecoleccionMedida[]): string {
  const filas = r.map((x) => {
    const completada = x.estado === "completada";
    return [
      x.fecha, x.folio, x.cliente, x.placa, x.numeroViajeEnJornada, x.estado === "completada" ? "completada" : "no atendida",
      completada ? espera(x) : null,
      completada ? traslado(x) : null,
      completada && x.llegadaEn && x.finServicioEn ? minutos(x.finServicioEn, x.llegadaEn) : null,
      completada && x.regresoMasDescargaMin !== null ? x.regresoMasDescargaMin / Math.max(1, x.completadasDelViaje) : null,
      cicloDe(x),
      completada ? dentroDeVentana(x) : null,
      x.kmContrafactual,
    ].map(celda).join(",");
  });
  return `﻿${[ENCABEZADOS.join(","), ...filas].join("\r\n")}\r\n`;
}
