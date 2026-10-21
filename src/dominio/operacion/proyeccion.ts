import { llegadaConHorasPico } from "@/motor/traslados";
import { instanteDeMinutos, minutosDeHora } from "../plan/entrada";
import type { EstadoJornada, OpcionesProyeccion, ProyeccionJornada, TipoAlerta } from "./tipos";

/**
 * Minutos transcurridos desde la medianoche mexicana de la jornada: conserva segundos,
 * milisegundos y días posteriores. Los ISO reales se devuelven sin normalizarlos.
 */
export function proyectarJornada(estado: EstadoJornada, opciones: OpcionesProyeccion): ProyeccionJornada {
  const base = instanteDeMinutos(estado.fecha, 0).getTime();
  const minuto = (iso: string) => (Date.parse(iso) - base) / 60000;
  const iso = (min: number) => new Date(base + min * 60000).toISOString();
  const ahora = minuto(opciones.ahora);
  if (!Number.isFinite(ahora)) throw new Error("Hora de proyección inválida");
  const pendiente = (min: number) => Math.ceil(Math.max(min, ahora));
  const duracion = (inicio: string, fin: string) => Math.max(0, minuto(fin) - minuto(inicio));
  const resultado: ProyeccionJornada = { jornadaId: estado.jornadaId, viajes: [], alertas: [] };
  let disponible = -Infinity;
  for (const v of estado.viajes) {
    const modelo = v.tiempos;
    const indice = new Map<string, number>(modelo?.puntos.map((p, i) => [p, i] as const));
    const traslado = (origen: string, destino: string, salida: number, aproximado: number) => {
      if (!modelo) return Math.ceil(salida) + Math.ceil(aproximado);
      const i = indice.get(origen), j = indice.get(destino);
      if (i === undefined || j === undefined || !Number.isFinite(modelo.minLibres[i]?.[j])
        || modelo.minLibres[i][j] < 0) throw new Error("Modelo de tiempos incompleto");
      return llegadaConHorasPico(Math.ceil(salida), modelo.minLibres[i][j], modelo.horasPico);
    };
    const salida = v.salidaPatioEn ?? iso(pendiente(Math.max(minuto(v.salidaEstimada), disponible)));
    let tiempo = minuto(salida), lugar = "patio", estimadaAnterior = v.salidaEstimada;
    let supuesta = false;
    const paradas: ProyeccionJornada["viajes"][number]["paradas"] = [];
    const enViajeEnCurso = v.salidaPatioEn !== null && v.descargaFinEn === null;
    const alerta = (tipo: TipoAlerta, paradaId: string | null, exceso: number) => {
      if (estado.checkOutEn || v.descargaFinEn || exceso <= 0) return;
      resultado.alertas.push({ tipo, rutaId: v.rutaId, paradaId, minutos: Math.ceil(exceso), enViajeEnCurso });
    };
    if (!v.salidaPatioEn) {
      const atraso = minuto(salida) - minuto(v.salidaEstimada);
      if (atraso >= opciones.umbralAtrasoMin) alerta("atraso", null, atraso);
    }
    for (const p of [...v.paradas].sort((a, b) => a.secuencia - b.secuencia)) {
      if (p.estado === "omitida" || p.estado === "reasignada") continue;
      // Los cierres son evidencia aun cuando la parada ya no sea vigente.
      if (p.estado === "completada" || p.estado === "no_atendida") {
        if (p.llegadaEn) { lugar = p.solicitudId; supuesta = false; }
        else if (p.estado === "no_atendida") supuesta = true;
        const real = p.cierreEn ?? p.inicioServicioEn ?? p.llegadaEn;
        if (real) tiempo = Math.max(tiempo, minuto(real));
        estimadaAnterior = p.estado === "no_atendida" ? p.llegadaEstimada : p.finEstimado;
        continue;
      }
      if (!p.vigente) continue;
      const llegada = p.llegadaEn ?? iso(pendiente(traslado(lugar, p.solicitudId, tiempo,
        duracion(estimadaAnterior, p.llegadaEstimada))));
      const espera = modelo ? 0 : duracion(p.llegadaEstimada, p.inicioEstimado);
      const inicio = p.inicioServicioEn ?? iso(pendiente(Math.max(minuto(llegada) + espera, minutosDeHora(p.ventanaInicio))));
      const fin = iso(pendiente(minuto(inicio) + duracion(p.inicioEstimado, p.finEstimado)));
      paradas.push({ paradaId: p.paradaId, llegada, inicio, fin, ubicacionSupuesta: supuesta });
      alerta("ventana_en_riesgo", p.paradaId, minuto(inicio) - minutosDeHora(p.ventanaFin));
      const atraso = minuto(llegada) - minuto(p.llegadaEstimada);
      if (atraso >= opciones.umbralAtrasoMin) alerta("atraso", p.paradaId, atraso);
      tiempo = minuto(fin); lugar = p.solicitudId; estimadaAnterior = p.finEstimado;
      // Una llegada real vuelve a fijar la ubicación conocida. Una proyectada no es evidencia.
      if (p.llegadaEn) supuesta = false;
    }
    const regreso = v.regresoPatioEn ?? iso(pendiente(traslado(lugar, "patio", tiempo,
      duracion(estimadaAnterior, v.regresoEstimado))));
    const descarga = modelo?.descargaMin ?? opciones.descargaMin;
    const finDescarga = v.descargaFinEn ?? iso(pendiente(minuto(regreso) + descarga));
    disponible = minuto(finDescarga);
    alerta("fuera_de_turno", null, disponible - (modelo?.turnoFinMin ?? opciones.turnoFinMin));
    resultado.viajes.push({ rutaId: v.rutaId, salida, regreso, finDescarga, aproximada: !modelo, paradas });
  }
  return resultado;
}
