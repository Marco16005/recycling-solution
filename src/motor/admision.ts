import { distanciaKm, minutosDeTraslado } from "./geometria";
import { compararTexto, ordenarFifo } from "./orden";
import { agruparZonas } from "./zonas";
import { ErrorAdmitidas } from "./tipos";
import { validarPlan } from "./validacion";
import type { Diagnostico, EntradaPlan, Plan, RestriccionesPlan, RutaPlan, SolicitudMotor, UnidadMotor, ViajePlan } from "./tipos";

const diagnosticoVacio = (): Diagnostico => ({ capacidad: 0, ventana: 0, finDeTurno: 0, afectaAOtra: 0 });
type Calculo = { ruta: RutaPlan } | { causa: keyof Diagnostico; afectaAOtra: boolean };

/** Recalcula desde el origen libre, nunca desde los horarios de la propuesta anterior. */
function calcular(
  entrada: EntradaPlan, unidad: UnidadMotor, viajes: string[][],
  solicitudes: Map<string, SolicitudMotor>, nueva?: string
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
      const km = distanciaKm(origen, s.ubicacion, p.factorCircuidad);
      const llegada = hora + minutosDeTraslado(km, p.velocidadKmh);
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
    const regresoKm = distanciaKm(origen, p.patio, p.factorCircuidad);
    viaje.km += regresoKm;
    viaje.regresoPatioMin = hora + minutosDeTraslado(regresoKm, p.velocidadKmh);
    hora = viaje.finDescargaMin = viaje.regresoPatioMin + p.descargaMin;
    if (hora > p.turnoFinMin) return { causa: "finDeTurno",
      afectaAOtra: ids.some(id => id !== nueva) || viajes.slice(i + 1).some(v => v.length > 0) };
    resultado.push(viaje);
    origen = p.patio;
  }
  return { ruta: { unidadId: unidad.id, viajes: resultado } };
}

export function generarPlan(entrada: EntradaPlan, restricciones?: RestriccionesPlan): Plan {
  const solicitudes = new Map(entrada.solicitudes.map(s => [s.id, s]));
  if (solicitudes.size !== entrada.solicitudes.length) throw new Error("Solicitudes repetidas en la entrada");
  if (new Set(entrada.unidades.map(u => u.id)).size !== entrada.unidades.length)
    throw new Error("Unidades repetidas en la entrada");
  const p = entrada.parametros;
  if (!(p.velocidadKmh > 0) || !Number.isFinite(p.velocidadKmh) || !(p.factorCircuidad >= 1)
    || !Number.isFinite(p.factorCircuidad) || p.descargaMin < 0) throw new Error("Parámetros de traslado inválidos");
  const unidades = [...entrada.unidades].sort((a, b) => compararTexto(a.id, b.id));
  const admitidas = new Set<string>();
  for (const [unidadId, viajes] of Object.entries(restricciones?.admitidas ?? {})) {
    const u = unidades.find(u => u.id === unidadId);
    if (!u) throw new ErrorAdmitidas(unidadId, "Unidad desconocida");
    for (const viaje of viajes) {
      if (!viaje.length) throw new ErrorAdmitidas(unidadId, "Viaje admitido vacío");
      for (const id of viaje) {
        const solicitud = solicitudes.get(id);
        if (!solicitud || admitidas.has(id)) throw new ErrorAdmitidas(unidadId, "Solicitud desconocida o repetida");
        if (!solicitud.tiposUnidadAdmitidos.includes(u.tipo)) throw new ErrorAdmitidas(unidadId, "Tipo no admitido");
        if (solicitud.cargaKg > Math.max(0, ...solicitud.tiposUnidadAdmitidos.map(t => p.capacidadMaximaPorTipoKg[t])))
          throw new ErrorAdmitidas(unidadId, "Solicitud físicamente bloqueada");
        admitidas.add(id);
      }
    }
  }
  let rutas: RutaPlan[] = unidades.map(u => {
    if (u.cargaActualKg < 0 || u.cargaActualKg > u.capacidadKg) throw new Error(`Carga inicial inválida: ${u.id}`);
    const fijadas = restricciones?.admitidas[u.id];
    const calculo = calcular(entrada, u, fijadas?.length ? fijadas : u.cargaActualKg > 0 ? [[]] : [], solicitudes);
    if (!("ruta" in calculo) && fijadas?.length) throw new ErrorAdmitidas(u.id, calculo.causa);
    if (!("ruta" in calculo)) throw new Error(`El regreso obligatorio de ${u.id} no cabe en el turno`);
    return calculo.ruta;
  });
  const fifo = ordenarFifo(entrada.solicitudes.filter(s => !admitidas.has(s.id)));
  const zonas = agruparZonas(fifo.map(s => s.ubicacion), unidades.length, p.patio, p.semilla);
  const plan: Plan = { versionMotor: "1.0.0", rutas: [], pospuestas: [], bloqueadas: [], traza: [],
    resumen: { ruteadas: 0, pospuestas: 0, bloqueadas: 0, km: 0, minutosTraslado: 0,
      kmMetodoActual: 0, minutosTrasladoMetodoActual: 0 } };
  for (const [indice, s] of fifo.entries()) {
    if (s.cargaKg > Math.max(0, ...s.tiposUnidadAdmitidos.map(t => p.capacidadMaximaPorTipoKg[t]))) {
      const motivo = "carga_mayor_a_capacidad_compatible" as const;
      plan.bloqueadas.push({ solicitudId: s.id, motivo });
      plan.traza.push({ solicitudId: s.id, resultado: "bloqueada", motivo });
      continue;
    }
    const diagnostico = diagnosticoVacio();
    // Rutas persistentes: cada cambio reemplaza la ruta y el arreglo; la traza conserva el estado anterior.
    const rutasAntes = rutas;
    const compatibles = unidades.map((u, i) => ({
      u, i, zona: i % Math.max(1, Math.min(unidades.length, fifo.length)) === zonas[indice] }))
      .filter(({ u }) => s.tiposUnidadAdmitidos.includes(u.tipo))
      .sort((a, b) => Number(b.zona) - Number(a.zona) || compararTexto(a.u.id, b.u.id));
    type Candidata = { ruta: RutaPlan; i: number; viaje: number; secuencia: number; costo: number; zona: boolean };
    const seleccion: { mejor?: Candidata } = {};
    const intentar = (c: typeof compatibles[number], viaje: number, posicion: number, nuevo: boolean) => {
      const ids = rutas[c.i].viajes.map(v => v.paradas.map(parada => parada.solicitudId));
      if (nuevo) ids.push([]);
      ids[viaje].splice(posicion, 0, s.id);
      const calculo = calcular(entrada, c.u, ids, solicitudes, s.id);
      if (!("ruta" in calculo)) {
        diagnostico[calculo.causa]++;
        if (calculo.afectaAOtra) diagnostico.afectaAOtra++;
        return;
      }
      const fin = calculo.ruta.viajes.at(-1)!.finDescargaMin;
      const anterior = rutas[c.i].viajes.at(-1)?.finDescargaMin
        ?? Math.max(entrada.instanteMin, c.u.libreDesdeMin, p.turnoInicioMin);
      const costo = nuevo ? fin : fin - anterior;
      const candidata = { ruta: calculo.ruta, i: c.i, viaje: viaje + 1, secuencia: posicion + 1, costo, zona: c.zona };
      const mejor = seleccion.mejor;
      if (!mejor || costo < mejor.costo || (costo === mejor.costo && (Number(c.zona) > Number(mejor.zona)
        || (c.zona === mejor.zona && compararTexto(c.u.id, unidades[mejor.i].id) < 0)))) seleccion.mejor = candidata;
    };
    for (const c of compatibles) for (const [v, viaje] of rutas[c.i].viajes.entries()) {
      for (let posicion = 0; posicion <= viaje.paradas.length; posicion++) intentar(c, v, posicion, false);
    }
    if (!seleccion.mejor) for (const c of compatibles) intentar(c, rutas[c.i].viajes.length, 0, true);
    if (seleccion.mejor) {
      const elegida = seleccion.mejor;
      rutas = rutas.map((ruta, i) => i === elegida.i ? elegida.ruta : ruta);
      plan.traza.push({ solicitudId: s.id, resultado: "admitida", unidadId: elegida.ruta.unidadId,
        viaje: elegida.viaje, secuencia: elegida.secuencia, rutasAntes });
    } else {
      const motivo = !unidades.length ? "sin_unidades_disponibles"
        : !compatibles.length ? "sin_unidad_compatible" : "sin_cupo";
      plan.pospuestas.push({ solicitudId: s.id, motivo, diagnostico: motivo === "sin_cupo" ? diagnostico : null });
      plan.traza.push({ solicitudId: s.id, resultado: "pospuesta", motivo, diagnostico, rutasAntes });
    }
  }
  plan.rutas = rutas;
  for (const ruta of rutas) for (const viaje of ruta.viajes) {
    plan.resumen.km += viaje.km;
    for (const parada of viaje.paradas) {
      const s = solicitudes.get(parada.solicitudId)!;
      const kmActual = distanciaKm(p.patio, s.ubicacion, p.factorCircuidad);
      plan.resumen.ruteadas++;
      plan.resumen.kmMetodoActual += 2 * kmActual;
      plan.resumen.minutosTrasladoMetodoActual += 2 * minutosDeTraslado(kmActual, p.velocidadKmh);
      plan.resumen.minutosTraslado += minutosDeTraslado(parada.kmDesdeAnterior, p.velocidadKmh);
    }
    // Usar los tiempos evita redondear un resto de distancias con error de coma flotante.
    plan.resumen.minutosTraslado += viaje.regresoPatioMin - (viaje.paradas.at(-1)?.finServicioMin ?? viaje.salidaMin);
  }
  plan.resumen.pospuestas = plan.pospuestas.length;
  plan.resumen.bloqueadas = plan.bloqueadas.length;
  const errores = validarPlan(entrada, plan, { restricciones });
  if (errores.length) throw new Error(`Plan inválido: ${errores.join("; ")}`);
  return plan;
}
