import type { SolicitudMotor } from "./tipos";

export const compararTexto = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** ISO con zona explícita, sin reloj: días gregorianos y fracción de día UTC. */
function instanteIso(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2})$/.exec(iso);
  if (!m) throw new Error(`Registro ISO inválido: ${iso}`);
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const anterior = anio - 1;
  const bisiesto = anio % 4 === 0 && (anio % 100 !== 0 || anio % 400 === 0);
  const diasMes = [31, bisiesto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const dias = 365 * anterior + Math.floor(anterior / 4) - Math.floor(anterior / 100) + Math.floor(anterior / 400)
    + diasMes.slice(0, mes - 1).reduce((a, b) => a + b, 0) + Number(m[3]);
  const zona = m[7] === "Z" ? 0 : (m[7][0] === "+" ? 1 : -1) * (Number(m[7].slice(1, 3)) * 60 + Number(m[7].slice(4)));
  return dias * 86400 + Number(m[4]) * 3600 + Number(m[5]) * 60 + Number(m[6]) - zona * 60;
}

export function ordenarFifo(solicitudes: SolicitudMotor[]): SolicitudMotor[] {
  const instantes = new Map(solicitudes.map(s => [s.id, instanteIso(s.registradaEn)]));
  return [...solicitudes].sort((a, b) => instantes.get(a.id)! - instantes.get(b.id)!
    || compararTexto(a.folio, b.folio) || compararTexto(a.id, b.id));
}
