import type { EstadoJornada, EventoEntrada, TipoEvento } from "./tipos";
import { aplicarEvento } from "./transiciones";

export interface AccionOperador {
  tipo: TipoEvento; texto: string; rutaId: string | null; paradaId: string | null;
  versionRuta: number | null; permiteNoAtendida: boolean;
}
const textos: Record<TipoEvento, string> = {
  check_in: "Llegué al patio", salida_patio: "Salgo del patio", llegada: "Llegué",
  inicio_servicio: "Empiezo", fin_servicio: "Terminé", no_atendida: "No se pudo atender",
  regreso_patio: "Regresé al patio", fin_descarga: "Terminé de descargar", check_out: "Termino jornada",
};
/** Usa la misma máquina que el servidor; el reloj de prueba procede del estado. */
export function siguienteAccion(estado: EstadoJornada): AccionOperador | null {
  const ocurridoEn = estado.ultimoOcurridoEn ?? `${estado.fecha}T12:00:00.000Z`;
  const base: EventoEntrada = { eventoId: "", jornadaId: estado.jornadaId, tipo: "check_in", ocurridoEn,
    rutaId: null, paradaId: null, versionRuta: null, odometroKm: estado.ultimoOdometroKm ?? 0, motivo: null };
  const candidatos: EventoEntrada[] = [{ ...base }];
  for (const v of estado.viajes) {
    const ruta = { ...base, rutaId: v.rutaId, versionRuta: v.version };
    candidatos.push({ ...ruta, tipo: "salida_patio" });
    for (const p of [...v.paradas].sort((a, b) => a.secuencia - b.secuencia)) {
      for (const tipo of ["llegada", "inicio_servicio", "fin_servicio"] as const)
        candidatos.push({ ...ruta, paradaId: p.paradaId, tipo });
    }
    candidatos.push({ ...ruta, tipo: "regreso_patio" }, { ...ruta, tipo: "fin_descarga" });
  }
  candidatos.push({ ...base, tipo: "check_out" });
  const evento = candidatos.find(e => aplicarEvento(estado, e, ocurridoEn).ok);
  if (!evento) return null;
  return { tipo: evento.tipo, texto: textos[evento.tipo], rutaId: evento.rutaId, paradaId: evento.paradaId,
    versionRuta: evento.versionRuta, permiteNoAtendida: evento.paradaId !== null
      && aplicarEvento(estado, { ...evento, tipo: "no_atendida", motivo: "No disponible" }, ocurridoEn).ok };
}

/** Proyección local: solo aplica efectos aceptados; nunca sustituye la respuesta del servidor. */
export function proyectarEvento(estado: EstadoJornada, evento: EventoEntrada): EstadoJornada {
  const resultado = aplicarEvento(estado, evento, evento.ocurridoEn);
  if (!resultado.ok) return estado;
  const copia: EstadoJornada = structuredClone(estado);
  copia.ultimoOcurridoEn = evento.ocurridoEn;
  for (const efecto of resultado.efectos) {
    if (efecto.tipo === "jornada") {
      if (efecto.campo === "check_in_en") copia.checkInEn = evento.ocurridoEn;
      else copia.checkOutEn = evento.ocurridoEn;
    }
    if (efecto.tipo === "ruta") {
      if (efecto.odometroKm !== undefined) copia.ultimoOdometroKm = efecto.odometroKm;
      const v = copia.viajes.find(v => v.rutaId === efecto.rutaId)!;
      if (efecto.campo === "salida_patio_en") { v.salidaPatioEn = evento.ocurridoEn; v.odometroInicioKm = evento.odometroKm; }
      if (efecto.campo === "regreso_patio_en") v.regresoPatioEn = evento.ocurridoEn;
      if (efecto.campo === "descarga_fin_en") v.descargaFinEn = evento.ocurridoEn;
    }
    if (efecto.tipo === "parada") {
      const p = copia.viajes.flatMap(v => v.paradas).find(p => p.paradaId === efecto.paradaId)!;
      p.estado = efecto.estado;
      if (efecto.liberar) p.vigente = false;
      if (efecto.campos.includes("llegada_en")) p.llegadaEn = evento.ocurridoEn;
      if (efecto.campos.includes("inicio_servicio_en")) p.inicioServicioEn = evento.ocurridoEn;
      if (efecto.campos.includes("cierre_en")) p.cierreEn = evento.ocurridoEn;
    }
  }
  return copia;
}
