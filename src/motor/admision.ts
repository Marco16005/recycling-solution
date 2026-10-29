import { calcular, diagnosticoVacio, resumenDe } from "./calculo";
import { crearTraslados, VERSION_MOTOR } from "./traslados";
import { compararTexto, ordenarFifo } from "./orden";
import { PRESUPUESTO_EVALUACIONES, PRESUPUESTO_READMISION, reacomodar, readmitir, tiempoMuerto } from "./reacomodo";
import { agruparZonas } from "./zonas";
import { ErrorAdmitidas } from "./tipos";
import { validarPlan } from "./validacion";
import type { EntradaPlan, Plan, RestriccionesPlan, RutaPlan } from "./tipos";

/** La fase 1 de un 1.2.0 es exactamente el motor 1.1.0. */
const VERSION_FASE_1 = "1.1.0";
/** Plan 8: si la entrada no la trae (entradas de pruebas y anteriores a la 0010), la de la configuración por omisión. */
export const TOLERANCIA_POR_OMISION_MIN = 15;

/** La tolerancia de la entrada, validada: entero de 0 a 60. */
export function toleranciaDe(entrada: EntradaPlan): number {
  const t = entrada.parametros.toleranciaReadmisionMin ?? TOLERANCIA_POR_OMISION_MIN;
  if (!Number.isInteger(t) || t < 0 || t > 60) throw new Error("Tolerancia de readmisión inválida");
  return t;
}

/** Fase 1 sin validar: admisión FIFO de la 1.1.0, con lo que las fases siguientes necesitan. */
function admision(entrada: EntradaPlan, restricciones?: RestriccionesPlan) {
  const solicitudes = new Map(entrada.solicitudes.map(s => [s.id, s]));
  if (solicitudes.size !== entrada.solicitudes.length) throw new Error("Solicitudes repetidas en la entrada");
  if (new Set(entrada.unidades.map(u => u.id)).size !== entrada.unidades.length)
    throw new Error("Unidades repetidas en la entrada");
  const p = entrada.parametros;
  const t = crearTraslados(entrada);
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
    const calculo = calcular(entrada, u, fijadas?.length ? fijadas : u.cargaActualKg > 0 ? [[]] : [], solicitudes, t);
    if (!("ruta" in calculo) && fijadas?.length) throw new ErrorAdmitidas(u.id, calculo.causa);
    if (!("ruta" in calculo)) throw new Error(`El regreso obligatorio de ${u.id} no cabe en el turno`);
    return calculo.ruta;
  });
  const fifo = ordenarFifo(entrada.solicitudes.filter(s => !admitidas.has(s.id)));
  const zonas = agruparZonas(fifo.map(s => s.ubicacion), unidades.length, p.patio, p.semilla);
  const plan: Plan = { versionMotor: VERSION_FASE_1, rutas: [], pospuestas: [], bloqueadas: [], traza: [],
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
      const calculo = calcular(entrada, c.u, ids, solicitudes, t, s.id);
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
  plan.resumen = resumenDe(entrada, t, rutas, plan.pospuestas.length, plan.bloqueadas.length);
  return { plan, solicitudes, t };
}

/**
 * Fase 1 sola: el plan exacto del motor 1.1.0 (versión "1.1.0"), validado como tal. Para la simulación (comparar con y
 * sin reacomodo) y las pruebas de regresión; la aplicación usa generarPlan.
 */
export function admitir(entrada: EntradaPlan, restricciones?: RestriccionesPlan): Plan {
  const { plan } = admision(entrada, restricciones);
  const errores = validarPlan(entrada, plan, { restricciones });
  if (errores.length) throw new Error(`Plan inválido: ${errores.join("; ")}`);
  return plan;
}

/**
 * Motor 1.2.0 (Plan 8, §4.1): admisión FIFO (fase 1, igual a la 1.1.0), reacomodo (fase 2), readmisión de las
 * pospuestas sin cupo (fase 3) y reacomodo final (fase 4). Valida el plan completo antes de devolverlo.
 */
export function generarPlan(entrada: EntradaPlan, restricciones?: RestriccionesPlan): Plan {
  const tolerancia = toleranciaDe(entrada);
  const { plan: fase1, solicitudes, t } = admision(entrada, restricciones);
  const fase2 = reacomodar(entrada, fase1.rutas, solicitudes, restricciones, PRESUPUESTO_EVALUACIONES);
  // Fase 3: solo las pospuestas sin cupo, en orden FIFO; sin unidades o sin una compatible no se reintentan.
  const sinCupo = fase1.pospuestas.filter(p => p.motivo === "sin_cupo").map(p => p.solicitudId);
  const readmision = readmitir(entrada, fase2.rutas, solicitudes, restricciones, sinCupo, tolerancia, PRESUPUESTO_READMISION);
  const decisiones = new Map(readmision.decisiones.map(d => [d.solicitudId, d]));
  const fase3 = {
    rutas: readmision.rutas, readmision: readmision.decisiones, evaluaciones: readmision.evaluaciones,
    pospuestas: fase1.pospuestas.flatMap(p => {
      const d = decisiones.get(p.solicitudId);
      if (!d) return [p];
      return d.resultado === "admitida" ? [] : [{ solicitudId: p.solicitudId, motivo: d.motivo, diagnostico: d.diagnostico }];
    }),
  };
  const fase4 = reacomodar(entrada, fase3.rutas, solicitudes, restricciones, PRESUPUESTO_EVALUACIONES);
  const resumen = { ...resumenDe(entrada, t, fase4.rutas, fase3.pospuestas.length, fase1.bloqueadas.length),
    tiempoMuertoMin: tiempoMuerto(entrada, fase4.rutas) };
  const plan: Plan = {
    versionMotor: VERSION_MOTOR, rutas: fase4.rutas, pospuestas: fase3.pospuestas, bloqueadas: fase1.bloqueadas,
    traza: fase1.traza, resumen,
    reacomodo: {
      antes: { ...fase1.resumen, tiempoMuertoMin: tiempoMuerto(entrada, fase1.rutas) },
      despues: { ...resumen },
      rutasReacomodadas: fase2.rutas,
      readmision: fase3.readmision,
      movimientos: { fase2: fase2.movimientos, fase4: fase4.movimientos },
      evaluaciones: { fase2: fase2.evaluaciones, readmision: fase3.evaluaciones, fase4: fase4.evaluaciones },
    },
  };
  const errores = validarPlan(entrada, plan, { restricciones });
  if (errores.length) throw new Error(`Plan inválido: ${errores.join("; ")}`);
  return plan;
}

