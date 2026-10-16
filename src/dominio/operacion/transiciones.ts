import { fechaEnMexico } from "../tiempo";
import type { Efecto, EstadoJornada, EventoEntrada } from "./tipos";
const rechazar = (motivo: string) => ({ ok: false as const, motivo });
const aplicar = (...efectos: Efecto[]) => ({ ok: true as const, efectos });
const activa = (estado: string) => estado === "en_sitio" || estado === "en_servicio";
const cerrada = (estado: string) => ["completada", "no_atendida", "reasignada", "omitida"].includes(estado);
const rutaCambiada = () => rechazar("La ruta cambió: llama al despachador");

/** Pura: todas las horas y el estado proceden del llamador; no modifica sus argumentos. */
export function aplicarEvento(estado: EstadoJornada, evento: EventoEntrada, recibidoEn: string):
  | { ok: true; efectos: Efecto[] } | { ok: false; motivo: string } {
  if (evento.jornadaId !== estado.jornadaId) return rechazar("Jornada incorrecta");
  if (estado.checkOutEn) return rechazar("La jornada ya terminó");
  const ocurrido = Date.parse(evento.ocurridoEn), recibido = Date.parse(recibidoEn);
  if (!Number.isFinite(ocurrido) || !Number.isFinite(recibido)) return rechazar("Hora inválida");
  if (fechaEnMexico(new Date(ocurrido)) !== estado.fecha) return rechazar("El evento no corresponde a la fecha de la jornada");
  if (estado.ultimoOcurridoEn && ocurrido < Date.parse(estado.ultimoOcurridoEn)) return rechazar("Hora anterior al último evento aplicado");
  if (ocurrido > recibido + 120_000) return rechazar("Hora más de dos minutos en el futuro");
  if (recibido - ocurrido > 86_400_000) return rechazar("Evento recibido después de 24 horas");
  const deJornada = evento.tipo === "check_in" || evento.tipo === "check_out";
  if (deJornada && (evento.rutaId !== null || evento.paradaId !== null || evento.versionRuta !== null))
    return rechazar("Referencias inválidas para un evento de jornada");
  if (evento.tipo === "check_in") return estado.checkInEn ? rechazar("La jornada ya inició")
    : aplicar({ tipo: "jornada", campo: "check_in_en" });
  if (!estado.checkInEn) return rechazar("Falta llegar al patio");
  if (evento.tipo === "check_out") {
    if (estado.viajes.some(v => (v.salidaPatioEn && !v.descargaFinEn)
      || v.paradas.some(p => p.vigente && (p.estado === "pendiente" || activa(p.estado)))))
      return rechazar("Hay viajes sin descargar o paradas pendientes");
    return aplicar({ tipo: "jornada", campo: "check_out_en" });
  }
  const indice = estado.viajes.findIndex(v => v.rutaId === evento.rutaId);
  const viaje = estado.viajes[indice];
  if (!viaje || viaje.version !== evento.versionRuta) return rutaCambiada();
  const deParada = ["llegada", "inicio_servicio", "fin_servicio", "no_atendida"].includes(evento.tipo);
  if (!deParada && evento.paradaId !== null) return rechazar("Referencia de parada inválida");
  const odometroValido = (minimo: number) => evento.odometroKm !== null
    && Number.isFinite(evento.odometroKm) && evento.odometroKm >= minimo;
  switch (evento.tipo) {
    case "salida_patio":
      if (viaje.salidaPatioEn) return rechazar("El viaje ya salió");
      if (estado.viajes.slice(0, indice).some(v => !v.descargaFinEn)) return rechazar("Falta descargar el viaje anterior");
      if (!viaje.paradas.some(p => p.vigente)) return rutaCambiada();
      if (!odometroValido(Math.max(0, estado.ultimoOdometroKm ?? 0))) return rechazar("Odómetro inválido o decreciente");
      return aplicar({ tipo: "ruta", rutaId: viaje.rutaId, campo: "salida_patio_en", odometroKm: evento.odometroKm! },
        { tipo: "solicitudes", rutaId: viaje.rutaId, estado: "en_ruta" });
    case "regreso_patio":
      if (!viaje.salidaPatioEn || viaje.regresoPatioEn) return rechazar("El viaje no está en recorrido");
      if (viaje.paradas.some(p => !cerrada(p.estado))) return rechazar("Hay paradas sin cerrar");
      if (!odometroValido(Math.max(0, viaje.odometroInicioKm ?? 0, estado.ultimoOdometroKm ?? 0)))
        return rechazar("Odómetro inválido o decreciente");
      return aplicar({ tipo: "ruta", rutaId: viaje.rutaId, campo: "regreso_patio_en", odometroKm: evento.odometroKm! });
    case "fin_descarga": {
      if (!viaje.regresoPatioEn || viaje.descargaFinEn) return rechazar("El viaje no está pendiente de descarga");
      const efectos: Efecto[] = [{ tipo: "ruta", rutaId: viaje.rutaId, campo: "descarga_fin_en" }];
      const siguiente = estado.viajes[indice + 1];
      if (siguiente) efectos.push({ tipo: "disponibilidad_siguiente", rutaId: siguiente.rutaId });
      return aplicar(...efectos);
    }
  }
  if (!deParada) return rechazar("Tipo de evento desconocido");
  const parada = viaje.paradas.find(p => p.paradaId === evento.paradaId);
  if (!parada?.vigente) return rutaCambiada();
  if (!viaje.salidaPatioEn || viaje.regresoPatioEn) return rechazar("El viaje no está en recorrido");
  const primera = [...viaje.paradas].sort((a, b) => a.secuencia - b.secuencia)
    .find(p => p.vigente && p.estado === "pendiente");
  const otraActiva = estado.viajes.some(v => v.paradas.some(p => activa(p.estado) && p.paradaId !== parada.paradaId));
  switch (evento.tipo) {
    case "llegada":
      if (parada.estado !== "pendiente" || primera !== parada || otraActiva) return rechazar("La parada no es la siguiente disponible");
      return aplicar({ tipo: "parada", paradaId: parada.paradaId, estado: "en_sitio", campos: ["llegada_en"] });
    case "inicio_servicio":
      if (parada.estado !== "en_sitio") return rechazar("Falta llegar a la parada");
      return aplicar({ tipo: "parada", paradaId: parada.paradaId, estado: "en_servicio", campos: ["inicio_servicio_en"] });
    case "fin_servicio":
      if (parada.estado !== "en_servicio") return rechazar("Falta iniciar el servicio");
      return aplicar({ tipo: "parada", paradaId: parada.paradaId, estado: "completada", campos: ["fin_servicio_en", "cierre_en"] },
        { tipo: "solicitud", paradaId: parada.paradaId, estado: "atendida" });
    case "no_atendida":
      if (!evento.motivo?.trim() || evento.motivo.length > 200) return rechazar("Se requiere un motivo de hasta 200 caracteres");
      if (parada.estado !== "en_sitio" && !(parada.estado === "pendiente" && primera === parada && !otraActiva))
        return rechazar("La parada no puede marcarse no atendida");
      // La solicitud se libera después de cerrar la parada, en el orden que consume la acción.
      return aplicar({ tipo: "parada", paradaId: parada.paradaId, estado: "no_atendida", campos: ["cierre_en"], motivo: evento.motivo, liberar: true },
        { tipo: "solicitud", paradaId: parada.paradaId, estado: "pendiente_siguiente_dia" });
    default: return rechazar("Tipo de evento desconocido");
  }
}

