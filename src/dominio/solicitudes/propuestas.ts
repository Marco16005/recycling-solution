import type { Recurrencia } from "../clientes/tipos";

/** Plan CRM, §4.4: propuestas de recolección que el despachador confirma. Pura: las fechas son AAAA-MM-DD. */

export interface Ritmo { dias: number; ultima: string; muestra: number }
export interface DecisionPropuesta { fecha: string; estado: "confirmada" | "descartada" | "pospuesta"; pospuestaHasta: string | null }
export interface CandidatoPropuesta {
  clienteId: string; activo: boolean; habilitadoEnFecha: boolean; tieneSolicitudAbierta: boolean;
  recurrencia: Recurrencia | null; ritmo: Ritmo | null; decisiones: DecisionPropuesta[];
}
/** "pospuesta": una posposición que ya venció (se propone en el primer día de operación ≥ pospuestaHasta). */
export interface Propuesta { clienteId: string; motivos: ("recurrencia" | "ritmo" | "pospuesta")[]; fechaEsperada: string | null; ritmo: Ritmo | null }

export const VENTANA_RITMO_DIAS = 180;
export const MINIMO_RITMO = 3;
export const TOLERANCIA_PROPUESTA_DIAS = 3;

const dia = (fecha: string) => Date.parse(`${fecha}T00:00:00Z`) / 86_400_000;   // entero: días desde 1970-01-01
const fechaDe = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);
const diaSemana = (fecha: string) => new Date(`${fecha}T12:00:00Z`).getUTCDay();

/** Con 3 o más solicitudes atendidas en los últimos 180 días: mediana (redondeada) de días entre fechas consecutivas. */
export function ritmoAprendido(fechasAtendidas: string[], hoy: string): Ritmo | null {
  const desde = dia(hoy) - VENTANA_RITMO_DIAS;
  const dias = [...new Set(fechasAtendidas.map(dia))].filter((d) => d >= desde && d <= dia(hoy)).sort((a, b) => a - b);
  if (dias.length < MINIMO_RITMO) return null;
  const diferencias = dias.slice(1).map((d, i) => d - dias[i]).sort((a, b) => a - b);
  const medio = Math.floor(diferencias.length / 2);
  const mediana = diferencias.length % 2 ? diferencias[medio] : (diferencias[medio - 1] + diferencias[medio]) / 2;
  return { dias: Math.round(mediana), ultima: fechaDe(dias.at(-1)!), muestra: dias.length };
}

export function tocaRecurrencia(r: Recurrencia, fecha: string): boolean {
  if (r.tipo === "dias_semana") return r.dias.includes(diaSemana(fecha));
  const transcurridos = dia(fecha) - dia(r.desde);
  return transcurridos >= 0 && transcurridos % r.cadaDias === 0;
}

export function propuestasParaFecha(fecha: string, diasOperacion: number[], candidatos: CandidatoPropuesta[]): Propuesta[] {
  if (!diasOperacion.includes(diaSemana(fecha))) return [];
  const d = dia(fecha);
  const salida: Propuesta[] = [];
  for (const c of candidatos) {
    if (!c.activo || !c.habilitadoEnFecha || c.tieneSolicitudAbierta) continue;
    if (c.decisiones.some((x) => x.fecha === fecha)) continue;
    const ultima = [...c.decisiones].filter((x) => dia(x.fecha) < d).sort((a, b) => dia(a.fecha) - dia(b.fecha)).at(-1);
    const pospuesta = ultima?.estado === "pospuesta" && ultima.pospuestaHasta !== null;
    if (pospuesta && dia(ultima.pospuestaHasta!) > d) continue;
    const motivos: Propuesta["motivos"] = [];
    if (c.recurrencia && tocaRecurrencia(c.recurrencia, fecha)) motivos.push("recurrencia");
    const esperada = c.ritmo ? dia(c.ritmo.ultima) + c.ritmo.dias : null;
    if (esperada !== null && esperada <= d && esperada >= d - TOLERANCIA_PROPUESTA_DIAS) motivos.push("ritmo");
    // Una posposición vencida siempre se muestra, también junto a ritmo o recurrencia: el despachador ya la había visto.
    if (pospuesta) motivos.push("pospuesta");
    if (motivos.length === 0) continue;
    salida.push({
      clienteId: c.clienteId, motivos, ritmo: c.ritmo,
      fechaEsperada: motivos.includes("ritmo") ? fechaDe(esperada!) : pospuesta ? ultima!.pospuestaHasta : fecha,
    });
  }
  return salida;
}
