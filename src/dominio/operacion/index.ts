import { createHash } from "node:crypto";
import { fechaEnMexico } from "../tiempo";
import type { EstadoJornada, EventoEntrada } from "./tipos";
export type * from "./tipos";

const rechazar = (motivo: string) => ({ ok: false as const, motivo });
const activa = (estado: string) => estado === "en_sitio" || estado === "en_servicio";
const cerrada = (estado: string) => ["completada", "no_atendida", "reasignada", "omitida"].includes(estado);

/** SHA-256 determinista del contrato, claves ordenadas y null explícitos; excluye metadatos del transporte. */
export function huellaEvento(evento: EventoEntrada): string {
  const contenido: EventoEntrada = { eventoId: evento.eventoId, jornadaId: evento.jornadaId, tipo: evento.tipo,
    ocurridoEn: evento.ocurridoEn, rutaId: evento.rutaId, paradaId: evento.paradaId, versionRuta: evento.versionRuta,
    odometroKm: evento.odometroKm, motivo: evento.motivo };
  return createHash("sha256").update(JSON.stringify(Object.fromEntries(
    Object.entries(contenido).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  )), "utf8").digest("hex");
}

/**
 * Frontera sobre toda la secuencia operativa, no solo el último plan.
 * Conserva cierres históricos incluso no vigentes; excluye reasignadas y omitidas.
 * El último hito se elige por instante real (empates por orden operativo).
 * Los minutos se redondean hacia arriba para nunca liberar antes del instante calculado;
 * pueden superar 1440 si la descarga estimada más retraso cae al día siguiente.
 */
export function fronteraDeReruteo(estado: EstadoJornada, disponible: boolean, ahora: string):
  | { ok: true; congeladas: string[]; viajeEnCurso: string | null; retrasoMin: number; libreDesdeMin: number;
      admitidas: string[][]; aReubicar: string[] }
  | { ok: false; motivo: string } {
  const instante = Date.parse(ahora);
  if (!Number.isFinite(instante) || fechaEnMexico(new Date(instante)) !== estado.fecha) return rechazar("Hora fuera de la jornada");
  const enCurso = estado.viajes.find(v => v.salidaPatioEn && !v.descargaFinEn);
  if (!disponible && estado.viajes.some(v => v.paradas.some(p => activa(p.estado))))
    return rechazar("Cierra la parada en sitio o en servicio antes de retirar la jornada");
  const congeladas: string[] = [], admitidas: string[][] = [], aReubicar: string[] = [];
  for (const viaje of estado.viajes) {
    const futuras: string[] = [];
    for (const p of viaje.paradas) {
      if (p.estado === "completada" || p.estado === "no_atendida") congeladas.push(p.solicitudId);
      else if (p.vigente && !cerrada(p.estado)) {
        if (disponible && viaje === enCurso) congeladas.push(p.solicitudId);
        else if (disponible) futuras.push(p.solicitudId);
        else aReubicar.push(p.solicitudId);
      }
    }
    if (futuras.length) admitidas.push(futuras);
  }
  let retrasoMin = 0;
  if (enCurso) {
    const hitos: [string | null, string][] = [[enCurso.salidaPatioEn, enCurso.salidaEstimada]];
    for (const p of [...enCurso.paradas].sort((a, b) => a.secuencia - b.secuencia)) {
      hitos.push([p.llegadaEn, p.llegadaEstimada], [p.inicioServicioEn, p.inicioEstimado],
        [p.cierreEn, p.estado === "no_atendida" ? p.llegadaEstimada : p.finEstimado]);
    }
    hitos.push([enCurso.regresoPatioEn, enCurso.regresoEstimado], [enCurso.descargaFinEn, enCurso.finDescargaEstimado]);
    let ultimo = -Infinity;
    for (const [real, estimada] of hitos) if (real && Date.parse(real) >= ultimo) {
      ultimo = Date.parse(real);
      retrasoMin = Math.max(0, (ultimo - Date.parse(estimada)) / 60_000);
    }
  }
  const partes = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Mexico_City", hourCycle: "h23",
    hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(instante));
  const parte = (tipo: string) => Number(partes.find(p => p.type === tipo)!.value);
  const minutoAhora = parte("hour") * 60 + parte("minute") + parte("second") / 60 + (instante % 1000) / 60_000;
  const libre = disponible && enCurso ? Math.max(instante, Date.parse(enCurso.finDescargaEstimado) + retrasoMin * 60_000) : instante;
  return { ok: true, congeladas, viajeEnCurso: enCurso?.rutaId ?? null, retrasoMin,
    libreDesdeMin: Math.ceil(minutoAhora + (libre - instante) / 60_000), admitidas, aReubicar };
}

export { aplicarEvento } from "./transiciones";
export { siguienteAccion } from "./siguiente-accion";
