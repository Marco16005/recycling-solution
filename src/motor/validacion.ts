import { crearTraslados } from "./traslados";
import { ErrorTraslados, type Traslados } from "./tipos";
import type { EntradaPlan, Plan, RestriccionesPlan, RutaPlan, SolicitudMotor, UnidadMotor, ViajePlan } from "./tipos";

/** Comparación estructural sin depender del orden de las claves de un objeto. */
function iguales(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number")
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-8;
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  return Object.keys(x).length === Object.keys(y).length
    && Object.keys(x).every(k => Object.hasOwn(y, k) && iguales(x[k], y[k]));
}

const texto = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Conversión independiente: calendario gregoriano con marzo como primer mes. */
function segundosUtc(iso: string): number {
  const partes = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2})$/.exec(iso);
  if (!partes) return NaN;
  const [, aa, mm, dd, hh, mi, ss, zona] = partes;
  const mes = Number(mm);
  const anio = Number(aa) - (mes <= 2 ? 1 : 0);
  const era = Math.floor(anio / 400);
  const enEra = anio - era * 400;
  const dias = era * 146097 + enEra * 365 + Math.floor(enEra / 4) - Math.floor(enEra / 100)
    + Math.floor((153 * (mes + (mes > 2 ? -3 : 9)) + 2) / 5) + Number(dd) - 1;
  const desfase = zona === "Z" ? 0
    : (zona[0] === "-" ? -1 : 1) * (Number(zona.slice(1, 3)) * 3600 + Number(zona.slice(4)) * 60);
  return dias * 86400 + Number(hh) * 3600 + Number(mi) * 60 + Number(ss) - desfase;
}

/**
 * Oráculo independiente: recorre las secuencias y propaga el horario mínimo.
 * Con ventanas que limitan el inicio, empezar antes nunca perjudica una visita posterior.
 * No importa admisión, orden, zonas ni sus auxiliares.
 */
export function validarPlan(entrada: EntradaPlan, plan: Plan,
  opciones?: { ajustadoAMano?: boolean; restricciones?: RestriccionesPlan }): string[] {
  let t: Traslados;
  try { t = crearTraslados(entrada); } catch (error) {
    if (error instanceof ErrorTraslados) return [error.message];
    throw error;
  }
  const manual = opciones?.ajustadoAMano === true;
  const errores: string[] = [];
  const restricciones = opciones?.restricciones?.admitidas ?? {};
  const admitidas = new Set<string>();
  // Contrasta el resultado directamente con el contrato, aunque la traza haya sido alterada.
  for (const [unidadId, viajes] of Object.entries(restricciones)) {
    if (!entrada.unidades.some(u => u.id === unidadId)) errores.push(`Unidad admitida desconocida: ${unidadId}`);
    const ruta = plan.rutas.find(r => r.unidadId === unidadId);
    for (const [i, ids] of viajes.entries()) {
      if (!ids.length) errores.push(`Viaje admitido vacío: ${unidadId}`);
      const reales = ruta?.viajes[i]?.paradas.map(p => p.solicitudId) ?? [];
      let anterior = -1;
      for (const id of ids) {
        if (admitidas.has(id) || !entrada.solicitudes.some(s => s.id === id)) errores.push(`Admitida desconocida o repetida: ${id}`);
        admitidas.add(id);
        const posicion = reales.indexOf(id);
        if (posicion <= anterior) errores.push(`Admitida retirada, movida o desordenada: ${id}`);
        anterior = posicion;
      }
    }
  }
  if (!opciones?.ajustadoAMano && plan.pospuestas.some(s => s.motivo === "pospuesta_a_mano")) {
    errores.push("Posposición manual en un plan automático");
  }
  const p = entrada.parametros;
  const porId = new Map(entrada.solicitudes.map(s => [s.id, s]));
  const flota = [...entrada.unidades].sort((a, b) => texto(a.id, b.id));
  const unidades = new Map(flota.map(u => [u.id, u]));
  if (porId.size !== entrada.solicitudes.length) errores.push("Entrada con solicitudes repetidas");
  if (unidades.size !== flota.length) errores.push("Entrada con unidades repetidas");
  if (!["1.0.0", "1.1.0", "1.2.0"].includes(plan.versionMotor)) errores.push("Versión de motor desconocida");
  // Plan 8: reacomodo y tiempo muerto son obligatorios en 1.2.0 y no existen en las versiones anteriores.
  const v12 = plan.versionMotor === "1.2.0";
  if (!v12 && (plan.reacomodo !== undefined || plan.resumen.tiempoMuertoMin !== undefined))
    errores.push("Reacomodo y tiempo muerto solo existen en la versión 1.2.0");
  if (v12 && (plan.reacomodo === undefined || plan.resumen.tiempoMuertoMin === undefined))
    errores.push("La versión 1.2.0 exige reacomodo y tiempo muerto");
  if (!v12 && plan.pospuestas.some(x => x.motivo === "alarga_la_jornada")) errores.push("Motivo alarga_la_jornada fuera de la versión 1.2.0");
  const tolerancia = entrada.parametros.toleranciaReadmisionMin ?? 15;
  if (v12 && (!Number.isInteger(tolerancia) || tolerancia < 0 || tolerancia > 60)) errores.push("Tolerancia de readmisión inválida");
  if (plan.versionMotor === "1.0.0" && (entrada.traslados !== undefined || p.horasPico !== undefined))
    errores.push("La versión 1.0.0 no admite matriz ni horas pico");
  const bloqueada = (s: SolicitudMotor) => s.cargaKg
    > s.tiposUnidadAdmitidos.reduce((max, t) => Math.max(max, p.capacidadMaximaPorTipoKg[t]), 0);

  function reconstruir(u: UnidadMotor, secuencias: string[][]): RutaPlan | undefined {
    let disponible = Math.max(entrada.instanteMin, p.turnoInicioMin, u.libreDesdeMin);
    let lugar = u.ubicacionInicial;
    const viajes: ViajePlan[] = [];
    if (u.cargaActualKg < 0 || u.cargaActualKg > u.capacidadKg || (u.cargaActualKg > 0 && !secuencias.length)) return;
    for (const [indice, ids] of secuencias.entries()) {
      if (!ids.length && !(indice === 0 && u.cargaActualKg > 0)) return;
      const v: ViajePlan = { numero: indice + 1, salidaMin: disponible, paradas: [], regresoPatioMin: 0,
        finDescargaMin: 0, cargaKg: indice === 0 ? u.cargaActualKg : 0, km: 0 };
      for (const id of ids) {
        const s = porId.get(id);
        if (!s || bloqueada(s) || !s.tiposUnidadAdmitidos.includes(u.tipo)) return;
        v.cargaKg += s.cargaKg;
        if (v.cargaKg > u.capacidadKg) return;
        const distancia = t.tramo(lugar, s.ubicacion).km;
        const llegada = t.llegada(lugar, s.ubicacion, disponible);
        let inicio = Infinity;
        let ventanaElegida: SolicitudMotor["ventanas"][number] | undefined;
        for (const ventana of s.ventanas) {
          const candidato = Math.max(llegada, ventana.inicioMin);
          if (candidato <= ventana.finMin && (candidato < inicio || (candidato === inicio && (!ventanaElegida
            || ventana.inicioMin < ventanaElegida.inicioMin
            || (ventana.inicioMin === ventanaElegida.inicioMin && ventana.finMin < ventanaElegida.finMin))))) {
            inicio = candidato;
            ventanaElegida = ventana;
          }
        }
        if (!ventanaElegida) return;
        disponible = inicio + s.tiempoServicioMin;
        v.paradas.push({ solicitudId: id, secuencia: v.paradas.length + 1, kmDesdeAnterior: distancia,
          llegadaMin: llegada, esperaMin: inicio - llegada, inicioServicioMin: inicio, finServicioMin: disponible,
          ventana: { ...ventanaElegida } });
        v.km += distancia;
        lugar = s.ubicacion;
      }
      const retorno = t.tramo(lugar, p.patio).km;
      v.km += retorno;
      v.regresoPatioMin = t.llegada(lugar, p.patio, disponible);
      v.finDescargaMin = v.regresoPatioMin + p.descargaMin;
      if (!Number.isFinite(v.finDescargaMin) || v.finDescargaMin > p.turnoFinMin) return;
      disponible = v.finDescargaMin;
      lugar = p.patio;
      viajes.push(v);
    }
    return { unidadId: u.id, viajes };
  }

  /** §4.2: fin de descarga del último viaje − inicio efectivo − servicios, por unidad. */
  const tiempoMuertoDe = (rutas: RutaPlan[]) => rutas.reduce((suma, r) => {
    const u = unidades.get(r.unidadId), ultimo = r.viajes.at(-1);
    if (!u || !ultimo) return suma;
    const servicios = r.viajes.reduce((a, v) => a + v.paradas.reduce((b, x) => b + (porId.get(x.solicitudId)?.tiempoServicioMin ?? 0), 0), 0);
    return suma + ultimo.finDescargaMin - Math.max(entrada.instanteMin, p.turnoInicioMin, u.libreDesdeMin) - servicios;
  }, 0);
  const objetivo = (rutas: RutaPlan[]) => ({ tm: tiempoMuertoDe(rutas), km: rutas.reduce((a, r) => a + r.viajes.reduce((b, v) => b + v.km, 0), 0) });
  /** a no empeora a b en el orden (tiempo muerto, km). */
  const noEmpeora = (a: { tm: number; km: number }, b: { tm: number; km: number }) => a.tm < b.tm || (a.tm === b.tm && a.km <= b.km + 1e-6);
  const atendidas = (rutas: RutaPlan[]) => rutas.flatMap(r => r.viajes.flatMap(v => v.paradas.map(x => x.solicitudId))).sort(texto);
  /** Una ruta por unidad, en orden, cada una reconstruida de forma independiente y factible. */
  function rutasFactibles(rutas: RutaPlan[], etiqueta: string): boolean {
    if (rutas.length !== flota.length || rutas.some((r, k) => r.unidadId !== flota[k].id)) {
      errores.push(`${etiqueta}: no hay una ruta por unidad en orden`);
      return false;
    }
    let bien = true;
    for (const [k, r] of rutas.entries()) {
      const reconstruida = reconstruir(flota[k], r.viajes.map(v => v.paradas.map(x => x.solicitudId)));
      if (!reconstruida || !iguales(reconstruida, r)) { errores.push(`${etiqueta}: ruta no factible o inconsistente: ${r.unidadId}`); bien = false; }
    }
    return bien;
  }
  /** Las protegidas conservan unidad, índice de viaje y orden relativo. */
  function protegidasIntactas(rutas: RutaPlan[], etiqueta: string): void {
    for (const [unidadId, viajes] of Object.entries(restricciones)) {
      const ruta = rutas.find(r => r.unidadId === unidadId);
      for (const [k, protegidas] of viajes.entries()) {
        const reales = ruta?.viajes[k]?.paradas.map(x => x.solicitudId) ?? [];
        let desde = 0;
        for (const id of protegidas) {
          const j = reales.indexOf(id, desde);
          if (j < 0) { errores.push(`${etiqueta}: protegida movida: ${id}`); break; }
          desde = j + 1;
        }
      }
    }
  }
  function resumenDe(rutas: RutaPlan[], pospuestas: number, bloqueadas: number): Plan["resumen"] {
    const r: Plan["resumen"] = { ruteadas: 0, pospuestas, bloqueadas, km: 0, minutosTraslado: 0, kmMetodoActual: 0, minutosTrasladoMetodoActual: 0 };
    for (const ruta of rutas) {
      let origen = unidades.get(ruta.unidadId)?.ubicacionInicial ?? p.patio;
      for (const viaje of ruta.viajes) {
        r.km += viaje.km;
        for (const parada of viaje.paradas) {
          r.ruteadas++;
          const s = porId.get(parada.solicitudId);
          if (!s) continue;
          r.minutosTraslado += Math.ceil(t.tramo(origen, s.ubicacion).minLibres);
          origen = s.ubicacion;
          const ida = t.tramo(p.patio, s.ubicacion), vuelta = t.tramo(s.ubicacion, p.patio);
          r.kmMetodoActual += ida.km + vuelta.km;
          r.minutosTrasladoMetodoActual += Math.ceil(ida.minLibres) + Math.ceil(vuelta.minLibres);
        }
        r.minutosTraslado += Math.ceil(t.tramo(origen, p.patio).minLibres);
        origen = p.patio;
      }
    }
    return r;
  }

  if (entrada.solicitudes.some(s => !Number.isFinite(segundosUtc(s.registradaEn)))) errores.push("Registro ISO inválido");
  if (manual) {
    const fechaValida = (fecha: string) => {
      const ms = Date.parse(`${fecha}T00:00:00Z`);
      return /^\d{4}-\d{2}-\d{2}$/.test(fecha) && Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === fecha;
    };
    if (!fechaValida(entrada.fecha)) errores.push("Fecha del plan inválida");
    for (const s of entrada.solicitudes) {
      const partes = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:\d{2})$/.exec(s.registradaEn);
      if (!partes || !fechaValida(partes[1]) || Number(partes[2]) > 23 || Number(partes[3]) > 59
        || Number(partes[4]) >= 60 || (partes[5] !== "Z" && (Number(partes[5].slice(1, 3)) > 23 || Number(partes[5].slice(4)) > 59)))
        errores.push(`Registro ISO inválido: ${s.id}`);
    }
    for (const item of plan.bloqueadas) {
      const s = porId.get(item.solicitudId);
      if (!s || !bloqueada(s) || item.motivo !== "carga_mayor_a_capacidad_compatible")
        errores.push(`Bloqueo injustificado: ${item.solicitudId}`);
    }
    for (const item of plan.pospuestas) {
      const s = porId.get(item.solicitudId);
      if (!s || bloqueada(s)) {
        errores.push(`Pospuesta desconocida o físicamente bloqueada: ${item.solicitudId}`);
        continue;
      }
      const compatibles = flota.some(u => s.tiposUnidadAdmitidos.includes(u.tipo));
      switch (item.motivo) {
        case "sin_unidades_disponibles":
          if (flota.length) errores.push(`Hay unidades disponibles: ${s.id}`);
          break;
        case "sin_unidad_compatible":
          if (!flota.length || compatibles) errores.push(`Motivo de compatibilidad incorrecto: ${s.id}`);
          break;
        case "pospuesta_a_mano": break;
        case "sin_cupo": {
          const d = item.diagnostico;
          const campos = ["capacidad", "ventana", "finDeTurno", "afectaAOtra"] as const;
          if (!d || Object.keys(d).length !== campos.length
            || campos.some(c => !Number.isInteger(d[c]) || d[c] < 0)
            || d.capacidad + d.ventana + d.finDeTurno <= 0)
            errores.push(`Diagnóstico inválido: ${s.id}`);
          break;
        }
        default: errores.push(`Motivo de posposición incorrecto: ${s.id}`);
      }
      if (item.motivo !== "sin_cupo" && item.diagnostico !== null) errores.push(`Diagnóstico debe ser null: ${s.id}`);
    }
  } else {
    // La reconstrucción inicia con las descargas obligatorias, incluso sin decisiones.
    let estado: RutaPlan[] = flota.map(u => {
      const ruta = reconstruir(u, restricciones[u.id]?.length ? restricciones[u.id] : u.cargaActualKg > 0 ? [[]] : []);
      if (!ruta) errores.push(`Estado inicial inviable de ${u.id}`);
      return ruta ?? { unidadId: u.id, viajes: [] };
    });
    const fifo = entrada.solicitudes.filter(s => !admitidas.has(s.id)).sort((a, b) => segundosUtc(a.registradaEn) - segundosUtc(b.registradaEn)
      || texto(a.folio, b.folio) || texto(a.id, b.id));
    if (plan.traza.length !== fifo.length) errores.push("La traza no tiene una decisión por solicitud");
    const pospuestas: Plan["pospuestas"] = [];
    const bloqueadas: Plan["bloqueadas"] = [];

    function insertar(ruta: RutaPlan, s: SolicitudMotor, viaje: number, posicion: number): RutaPlan | undefined {
      const u = unidades.get(ruta.unidadId);
      if (!u || !s.tiposUnidadAdmitidos.includes(u.tipo)) return;
      const listas = ruta.viajes.map(v => v.paradas.map(parada => parada.solicitudId));
      if (!Number.isInteger(viaje) || viaje < 0 || viaje > listas.length) return;
      if (viaje === listas.length) listas.push([]);
      if (!Number.isInteger(posicion) || posicion < 0 || posicion > listas[viaje].length) return;
      listas[viaje] = [...listas[viaje].slice(0, posicion), s.id, ...listas[viaje].slice(posicion)];
      return reconstruir(u, listas);
    }

    for (const [i, decision] of plan.traza.entries()) {
      const s = porId.get(decision.solicitudId);
      if (!s) { errores.push(`Solicitud desconocida en traza: ${decision.solicitudId}`); continue; }
      if (admitidas.has(s.id) || fifo[i]?.id !== s.id) errores.push(`Orden FIFO incorrecto en decisión ${i + 1}`);
      if (decision.resultado === "bloqueada") {
        if (!bloqueada(s) || decision.motivo !== "carga_mayor_a_capacidad_compatible")
          errores.push(`Bloqueo injustificado: ${s.id}`);
        bloqueadas.push({ solicitudId: s.id, motivo: decision.motivo });
        continue;
      }
      if (bloqueada(s)) errores.push(`Solicitud físicamente bloqueada sin bloqueo: ${s.id}`);
      if (!iguales(decision.rutasAntes, estado)) errores.push(`La traza altera rutas anteriores a ${s.id}`);
      if (decision.resultado === "admitida") {
        const indice = estado.findIndex(r => r.unidadId === decision.unidadId);
        const ruta = indice < 0 ? undefined : insertar(estado[indice], s, decision.viaje - 1, decision.secuencia - 1);
        if (!ruta) errores.push(`Admisión no factible: ${s.id}`);
        else estado = estado.map((anterior, j) => j === indice ? ruta : anterior);
      } else {
        const compatibles = flota.filter(u => s.tiposUnidadAdmitidos.includes(u.tipo));
        const motivo = !flota.length ? "sin_unidades_disponibles"
          : !compatibles.length ? "sin_unidad_compatible" : "sin_cupo";
        if (decision.motivo !== motivo) errores.push(`Motivo de posposición incorrecto: ${s.id}`);
        let factible = false;
        for (const ruta of estado) {
          for (let v = 0; v <= ruta.viajes.length && !factible; v++) {
            const longitud = ruta.viajes[v]?.paradas.length ?? 0;
            for (let lugar = 0; lugar <= longitud; lugar++) {
              if (insertar(ruta, s, v, lugar)) { factible = true; break; }
            }
          }
          if (factible) break;
        }
        if (factible) errores.push(`FIFO: ${s.id} fue pospuesta teniendo una inserción factible`);
        const d = decision.diagnostico;
        if (!d || Object.values(d).some(n => !Number.isInteger(n) || n < 0)
          || (motivo === "sin_cupo" && d.capacidad + d.ventana + d.finDeTurno <= 0))
          errores.push(`Diagnóstico inválido: ${s.id}`);
        pospuestas.push({ solicitudId: s.id, motivo: decision.motivo, diagnostico: motivo === "sin_cupo" ? d : null });
      }
    }
    if (!v12) {
      if (!iguales(estado, plan.rutas)) errores.push(
        "Las rutas finales no coinciden con la reconstrucción factible de la traza "
        + "(horarios, ventanas, capacidad o secuencias)"
      );
    } else if (plan.reacomodo) {
      // Plan 8, §4.6. La traza da S1; se comprueban los resultados de cada fase sin repetir las búsquedas.
      const r = plan.reacomodo, s1 = estado;
      if (!iguales(r.antes, { ...resumenDe(s1, pospuestas.length, bloqueadas.length), tiempoMuertoMin: tiempoMuertoDe(s1) }))
        errores.push("reacomodo.antes no coincide con la admisión");
      const s2 = r.rutasReacomodadas;
      if (rutasFactibles(s2, "Reacomodo")) {
        if (!iguales(atendidas(s2), atendidas(s1))) errores.push("Reacomodo: cambió las solicitudes atendidas");
        protegidasIntactas(s2, "Reacomodo");
        if (!noEmpeora(objetivo(s2), objetivo(s1))) errores.push("Reacomodo: empeoró el tiempo muerto o los km");
      }
      // P8-3: readmisión. Mientras tanto S3 = S2 y las pospuestas finales son las de la fase 1.
      if (r.readmision.length) errores.push("Readmisión todavía no admitida");
      const s3 = s2;
      if (rutasFactibles(plan.rutas, "Reacomodo final")) {
        if (!iguales(atendidas(plan.rutas), atendidas(s3))) errores.push("Reacomodo final: cambió las solicitudes atendidas");
        if (!noEmpeora(objetivo(plan.rutas), objetivo(s3))) errores.push("Reacomodo final: empeoró el tiempo muerto o los km");
      }
      if (!iguales(r.despues, plan.resumen)) errores.push("reacomodo.despues no coincide con el resumen del plan");
      const contadores = [r.movimientos.fase2, r.movimientos.fase4, r.evaluaciones.fase2, r.evaluaciones.readmision, r.evaluaciones.fase4];
      if (contadores.some(n => !Number.isInteger(n) || n < 0)) errores.push("Contadores del reacomodo inválidos");
    }
    if (!iguales(pospuestas, plan.pospuestas)) errores.push("Pospuestas inconsistentes con la traza");
    if (!iguales(bloqueadas, plan.bloqueadas)) errores.push("Bloqueadas inconsistentes con la traza");
  }

  const apariciones = new Map<string, number>();
  const contar = (id: string) => apariciones.set(id, (apariciones.get(id) ?? 0) + 1);
  const resumen: Plan["resumen"] = resumenDe(plan.rutas, plan.pospuestas.length, plan.bloqueadas.length);
  if (v12) resumen.tiempoMuertoMin = tiempoMuertoDe(plan.rutas);
  const rutasVistas = new Set<string>();
  for (const ruta of plan.rutas) {
    const u = unidades.get(ruta.unidadId);
    if (!u || rutasVistas.has(ruta.unidadId)) errores.push(`Unidad desconocida o repetida: ${ruta.unidadId}`);
    rutasVistas.add(ruta.unidadId);
    if (manual && u) {
      const reconstruida = reconstruir(u, ruta.viajes.map(v => v.paradas.map(s => s.solicitudId)));
      if (!reconstruida || !iguales(reconstruida, ruta)) errores.push(`Ruta final no factible o inconsistente: ${ruta.unidadId}`);
    }
    for (const viaje of ruta.viajes) for (const parada of viaje.paradas) contar(parada.solicitudId);
  }
  if (manual) for (const id of unidades.keys()) {
    if (!rutasVistas.has(id)) errores.push(`Falta la ruta de la unidad: ${id}`);
  }
  for (const item of [...plan.pospuestas, ...plan.bloqueadas]) contar(item.solicitudId);
  for (const id of porId.keys()) if (apariciones.get(id) !== 1) errores.push(`Partición incorrecta: ${id}`);
  for (const id of apariciones.keys()) if (!porId.has(id)) errores.push(`Solicitud desconocida en el plan: ${id}`);
  if (!iguales(resumen, plan.resumen)) errores.push("Resumen inconsistente con las rutas");
  return errores;
}
