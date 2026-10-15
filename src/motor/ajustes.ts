import { distanciaKm, minutosDeTraslado } from "./geometria";
import { validarPlan } from "./validacion";
import type { AjusteManual, CausaNoFactible, EntradaPlan, Plan, RestriccionesPlan, ResultadoAjuste, ResultadoRecalculo, ViajePlan } from "./tipos";

const invalida = (detalle: string): Extract<ResultadoRecalculo, { error: "entrada_invalida" }> =>
  ({ ok: false, error: "entrada_invalida", detalle });

/** Recalcula las secuencias dadas con las reglas de admisión, sin reordenarlas. Solo plan inicial. */
export function recalcularRuta(entrada: EntradaPlan, unidadId: string, viajes: string[][]): ResultadoRecalculo {
  const p = entrada.parametros;
  const unidad = entrada.unidades.find(u => u.id === unidadId);
  if (!unidad) return invalida("Unidad desconocida");
  const solicitudes = new Map(entrada.solicitudes.map(s => [s.id, s]));
  if (solicitudes.size !== entrada.solicitudes.length || new Set(entrada.unidades.map(u => u.id)).size !== entrada.unidades.length)
    return invalida("Identificadores repetidos en la entrada");
  if (entrada.unidades.some(u => u.cargaActualKg !== 0
    || u.ubicacionInicial.lat !== p.patio.lat || u.ubicacionInicial.lng !== p.patio.lng))
    return invalida("Solo se admite el plan inicial desde el patio y sin carga");
  const ids = viajes.flat();
  if (new Set(ids).size !== ids.length || ids.some(id => !solicitudes.has(id)))
    return invalida("Solicitud desconocida o repetida");
  if (!Number.isFinite(p.velocidadKmh) || p.velocidadKmh <= 0 || !Number.isFinite(p.factorCircuidad)
    || p.factorCircuidad < 1 || !Number.isFinite(p.descargaMin) || p.descargaMin < 0)
    return invalida("Parámetros de traslado inválidos");

  let hora = Math.max(entrada.instanteMin, unidad.libreDesdeMin, p.turnoInicioMin);
  const resultado: ViajePlan[] = [];
  for (const lista of viajes.filter(v => v.length > 0)) {
    const numero = resultado.length + 1;
    const noFactible = (causa: CausaNoFactible, solicitudId: string | null): ResultadoRecalculo =>
      ({ ok: false, error: "no_factible", causa, viaje: numero, solicitudId });
    let origen = p.patio;
    const viaje: ViajePlan = { numero, salidaMin: hora, paradas: [], regresoPatioMin: 0,
      finDescargaMin: 0, cargaKg: 0, km: 0 };
    for (const id of lista) {
      const s = solicitudes.get(id)!;
      if (!s.tiposUnidadAdmitidos.includes(unidad.tipo)) return noFactible("tipoNoAdmitido", id);
      viaje.cargaKg += s.cargaKg;
      if (viaje.cargaKg > unidad.capacidadKg) return noFactible("capacidad", id);
      const km = distanciaKm(origen, s.ubicacion, p.factorCircuidad);
      const llegada = hora + minutosDeTraslado(km, p.velocidadKmh);
      const ventana = [...s.ventanas].sort((a, b) => a.inicioMin - b.inicioMin || a.finMin - b.finMin)
        .find(v => Math.max(llegada, v.inicioMin) <= v.finMin);
      if (!ventana) return noFactible("ventana", id);
      const inicio = Math.max(llegada, ventana.inicioMin);
      hora = inicio + s.tiempoServicioMin;
      if (hora > p.turnoFinMin) return noFactible("finDeTurno", id);
      viaje.paradas.push({ solicitudId: id, secuencia: viaje.paradas.length + 1, kmDesdeAnterior: km,
        llegadaMin: llegada, esperaMin: inicio - llegada, inicioServicioMin: inicio, finServicioMin: hora,
        ventana: { ...ventana } });
      viaje.km += km;
      origen = s.ubicacion;
    }
    const regresoKm = distanciaKm(origen, p.patio, p.factorCircuidad);
    viaje.km += regresoKm;
    viaje.regresoPatioMin = hora + minutosDeTraslado(regresoKm, p.velocidadKmh);
    hora = viaje.finDescargaMin = viaje.regresoPatioMin + p.descargaMin;
    if (hora > p.turnoFinMin) return noFactible("finDeTurno", null);
    resultado.push(viaje);
  }
  return { ok: true, ruta: { unidadId, viajes: resultado } };
}

/** Recalcula las rutas afectadas y el resumen completo; conserva la traza original y no muta los argumentos. */
export function ajustarPlan(entrada: EntradaPlan, plan: Plan, ajuste: AjusteManual, restricciones?: RestriccionesPlan): ResultadoAjuste {
  // R0a: no ignorar restricciones mientras su implementación (R2) está pendiente.
  if (restricciones && Object.values(restricciones.admitidas).some(viajes => viajes.length > 0))
    return invalida("Restricciones de admitidas pendientes de implementar (R2)");
  if (entrada.unidades.some(u => u.cargaActualKg !== 0
    || u.ubicacionInicial.lat !== entrada.parametros.patio.lat || u.ubicacionInicial.lng !== entrada.parametros.patio.lng))
    return invalida("Solo se admite el plan inicial desde el patio y sin carga");
  if (validarPlan(entrada, plan, { ajustadoAMano: true }).length) return invalida("Plan de origen inválido");
  let nuevaEntrada = entrada;
  const secuencias = new Map(plan.rutas.map(r => [r.unidadId, r.viajes.map(v => v.paradas.map(s => s.solicitudId))]));
  const afectadas = new Set<string>();
  let pospuestas = [...plan.pospuestas];
  if (ajuste.tipo === "actualizarHora") {
    if (!Number.isInteger(ajuste.instanteMin) || ajuste.instanteMin <= entrada.instanteMin)
      return invalida("La hora nueva debe ser un minuto entero posterior al actual");
    nuevaEntrada = { ...entrada, instanteMin: ajuste.instanteMin,
      unidades: entrada.unidades.map(u => ({ ...u, libreDesdeMin: Math.max(u.libreDesdeMin, ajuste.instanteMin) })) };
    for (const id of secuencias.keys()) afectadas.add(id);
  } else {
    if (!entrada.solicitudes.some(s => s.id === ajuste.solicitudId)
      || plan.bloqueadas.some(s => s.solicitudId === ajuste.solicitudId))
      return invalida("Solicitud desconocida o bloqueada");
    for (const [id, viajes] of secuencias) {
      if (viajes.some(v => v.includes(ajuste.solicitudId))) {
        afectadas.add(id);
        secuencias.set(id, viajes.map(v => v.filter(s => s !== ajuste.solicitudId)).filter(v => v.length > 0));
      }
    }
    pospuestas = pospuestas.filter(s => s.solicitudId !== ajuste.solicitudId);
    if (ajuste.tipo === "posponer") {
      pospuestas.push({ solicitudId: ajuste.solicitudId, motivo: "pospuesta_a_mano", diagnostico: null });
    } else {
      const viajes = secuencias.get(ajuste.unidadId);
      if (!viajes || !Number.isInteger(ajuste.viaje) || ajuste.viaje < 1 || ajuste.viaje > viajes.length + 1)
        return invalida("Unidad o viaje de destino inválido");
      if (ajuste.viaje === viajes.length + 1) viajes.push([]);
      const destino = viajes[ajuste.viaje - 1];
      if (!Number.isInteger(ajuste.posicion) || ajuste.posicion < 1 || ajuste.posicion > destino.length + 1)
        return invalida("Posición de destino inválida");
      destino.splice(ajuste.posicion - 1, 0, ajuste.solicitudId);
      afectadas.add(ajuste.unidadId);
    }
  }
  const rutas: Plan["rutas"] = [];
  for (const anterior of plan.rutas) {
    if (!afectadas.has(anterior.unidadId)) { rutas.push(anterior); continue; }
    const resultado = recalcularRuta(nuevaEntrada, anterior.unidadId, secuencias.get(anterior.unidadId)!);
    if (!resultado.ok) return resultado.error === "no_factible"
      ? { ...resultado, unidadId: anterior.unidadId } : resultado;
    rutas.push(resultado.ruta);
  }
  const resumen: Plan["resumen"] = { ruteadas: 0, pospuestas: pospuestas.length, bloqueadas: plan.bloqueadas.length,
    km: 0, minutosTraslado: 0, kmMetodoActual: 0, minutosTrasladoMetodoActual: 0 };
  const porId = new Map(entrada.solicitudes.map(s => [s.id, s]));
  const p = entrada.parametros;
  for (const ruta of rutas) for (const viaje of ruta.viajes) {
    resumen.km += viaje.km;
    for (const parada of viaje.paradas) {
      const s = porId.get(parada.solicitudId)!;
      const km = distanciaKm(p.patio, s.ubicacion, p.factorCircuidad);
      resumen.ruteadas++;
      resumen.kmMetodoActual += 2 * km;
      resumen.minutosTrasladoMetodoActual += 2 * minutosDeTraslado(km, p.velocidadKmh);
      resumen.minutosTraslado += minutosDeTraslado(parada.kmDesdeAnterior, p.velocidadKmh);
    }
    resumen.minutosTraslado += viaje.regresoPatioMin - (viaje.paradas.at(-1)?.finServicioMin ?? viaje.salidaMin);
  }
  const nuevo = { ...plan, rutas, pospuestas, resumen };
  if (validarPlan(nuevaEntrada, nuevo, { ajustadoAMano: true }).length) return invalida("El ajuste produce un plan inválido");
  return { ok: true, plan: nuevo, entrada: nuevaEntrada };
}
