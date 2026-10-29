/**
 * Cálculo de horarios de una ruta y resumen del plan, compartidos por la admisión (fase 1) y el reacomodo (Plan 8).
 * calcular es el de la admisión 1.1.0 sin cambios de comportamiento; la validación tiene su propio oráculo.
 */
import type { Diagnostico, EntradaPlan, Plan, RutaPlan, SolicitudMotor, Traslados, UnidadMotor, ViajePlan } from "./tipos";

export const diagnosticoVacio = (): Diagnostico => ({ capacidad: 0, ventana: 0, finDeTurno: 0, afectaAOtra: 0 });
export type Calculo = { ruta: RutaPlan } | { causa: "capacidad" | "ventana" | "finDeTurno"; afectaAOtra: boolean };

/** Recalcula desde el origen libre, nunca desde los horarios de la propuesta anterior. */
export function calcular(
  entrada: EntradaPlan, unidad: UnidadMotor, viajes: string[][],
  solicitudes: Map<string, SolicitudMotor>, t: Traslados, nueva?: string
): Calculo {
  const p = entrada.parametros;
  let hora = Math.max(entrada.instanteMin, unidad.libreDesdeMin, p.turnoInicioMin);
  let origen = unidad.ubicacionInicial;
  const resultado: ViajePlan[] = [];
  for (let i = 0; i < viajes.length; i++) {
    const ids = viajes[i];
    const cargaKg = (i === 0 ? unidad.cargaActualKg : 0)
      + ids.reduce((suma, id) => suma + solicitudes.get(id)!.cargaKg, 0);
    if (cargaKg > unidad.capacidadKg) return { causa: "capacidad", afectaAOtra: false };
    const viaje: ViajePlan = {
      numero: i + 1, salidaMin: hora, paradas: [], regresoPatioMin: 0, finDescargaMin: 0, cargaKg, km: 0
    };
    for (const id of ids) {
      const s = solicitudes.get(id)!;
      const km = t.tramo(origen, s.ubicacion).km;
      const llegada = t.llegada(origen, s.ubicacion, hora);
      const ventana = [...s.ventanas].sort((a, b) => a.inicioMin - b.inicioMin || a.finMin - b.finMin)
        .find(v => Math.max(llegada, v.inicioMin) <= v.finMin);
      if (!ventana) return { causa: "ventana", afectaAOtra: id !== nueva };
      const inicio = Math.max(llegada, ventana.inicioMin);
      hora = inicio + s.tiempoServicioMin;
      viaje.paradas.push({ solicitudId: id, secuencia: viaje.paradas.length + 1, kmDesdeAnterior: km,
        llegadaMin: llegada, esperaMin: inicio - llegada, inicioServicioMin: inicio, finServicioMin: hora,
        ventana: { ...ventana } });
      viaje.km += km;
      origen = s.ubicacion;
    }
    const regresoKm = t.tramo(origen, p.patio).km;
    viaje.km += regresoKm;
    viaje.regresoPatioMin = t.llegada(origen, p.patio, hora);
    hora = viaje.finDescargaMin = viaje.regresoPatioMin + p.descargaMin;
    if (hora > p.turnoFinMin) return { causa: "finDeTurno",
      afectaAOtra: ids.some(id => id !== nueva) || viajes.slice(i + 1).some(v => v.length > 0) };
    resultado.push(viaje);
    origen = p.patio;
  }
  return { ruta: { unidadId: unidad.id, viajes: resultado } };
}

/** El resumen de unas rutas, igual que el de la admisión 1.1.0 (sin tiempo muerto). */
export function resumenDe(entrada: EntradaPlan, t: Traslados, rutas: RutaPlan[], pospuestas: number, bloqueadas: number): Plan["resumen"] {
  const p = entrada.parametros;
  const porId = new Map(entrada.solicitudes.map(s => [s.id, s]));
  const resumen: Plan["resumen"] = { ruteadas: 0, pospuestas, bloqueadas, km: 0, minutosTraslado: 0,
    kmMetodoActual: 0, minutosTrasladoMetodoActual: 0 };
  for (const ruta of rutas) {
    let origen = entrada.unidades.find(u => u.id === ruta.unidadId)!.ubicacionInicial;
    for (const viaje of ruta.viajes) {
      resumen.km += viaje.km;
      for (const parada of viaje.paradas) {
        const s = porId.get(parada.solicitudId)!;
        const ida = t.tramo(p.patio, s.ubicacion), vuelta = t.tramo(s.ubicacion, p.patio);
        resumen.ruteadas++;
        resumen.kmMetodoActual += ida.km + vuelta.km;
        resumen.minutosTrasladoMetodoActual += Math.ceil(ida.minLibres) + Math.ceil(vuelta.minLibres);
        resumen.minutosTraslado += Math.ceil(t.tramo(origen, s.ubicacion).minLibres);
        origen = s.ubicacion;
      }
      resumen.minutosTraslado += Math.ceil(t.tramo(origen, p.patio).minLibres);
      origen = p.patio;
    }
  }
  return resumen;
}
