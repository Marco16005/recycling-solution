import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ajustarPlan, distanciaKm, generarPlan, minutosDeTraslado, recalcularRuta, validarPlan } from "./index";
import { entrada, patio, solicitud, unidad } from "./ejemplos.test-datos";
import type { AjusteManual, EntradaPlan, Plan, ResultadoRecalculo } from "./tipos";

const manual = { ajustadoAMano: true };
const secuencias = (p: Plan) => p.rutas.map(r => ({ unidadId: r.unidadId, viajes: r.viajes.map(v => v.paradas.map(s => s.solicitudId)) }));
const casos = fc.record({
  solicitudes: fc.array(fc.record({ carga: fc.integer({ min: 1, max: 9000 }), servicio: fc.integer({ min: 5, max: 120 }),
    apertura: fc.integer({ min: 450, max: 900 }), ancho: fc.integer({ min: 0, max: 180 }),
    x: fc.integer({ min: -30, max: 30 }), compatible: fc.boolean(),
  }), { minLength: 1, maxLength: 12 }),
  capacidad: fc.integer({ min: 1000, max: 8000 }), libre: fc.integer({ min: 480, max: 700 }),
}).map(d => entrada(d.solicitudes.map((s, i) => solicitud(`s${i}`, {
  cargaKg: s.carga, tiempoServicioMin: s.servicio, ubicacion: { lat: patio.lat + s.x / 1000, lng: patio.lng },
  ventanas: [{ inicioMin: s.apertura, finMin: s.apertura + s.ancho }],
  tiposUnidadAdmitidos: s.compatible ? ["doble_rodada", "camioneta"] : ["rabon"],
})), [unidad("u1", { capacidadKg: d.capacidad, libreDesdeMin: d.libre }), unidad("u2", { tipo: "camioneta", capacidadKg: 2000 })]));

/** Testigo independiente: calcula los prefijos por mínimos de ventanas, sin usar recalcularRuta. */
function comprobarRechazo(e: EntradaPlan, unidadId: string, listas: string[][], r: Extract<ResultadoRecalculo, { error: "no_factible" }>) {
  const u = e.unidades.find(u => u.id === unidadId)!;
  const viajes = listas.filter(v => v.length);
  expect(r.viaje).toBeGreaterThanOrEqual(1);
  expect(r.viaje).toBeLessThanOrEqual(viajes.length);
  let hora = Math.max(e.instanteMin, e.parametros.turnoInicioMin, u.libreDesdeMin);
  for (const [i, ids] of viajes.entries()) {
    let carga = 0;
    let origen = e.parametros.patio;
    for (const id of ids) {
      const s = e.solicitudes.find(s => s.id === id)!;
      carga += s.cargaKg;
      const llegada = hora + minutosDeTraslado(distanciaKm(origen, s.ubicacion, e.parametros.factorCircuidad), e.parametros.velocidadKmh);
      const inicios = s.ventanas.map(v => Math.max(llegada, v.inicioMin)).filter((t, j) => t <= s.ventanas[j].finMin);
      const fin = Math.min(...inicios) + s.tiempoServicioMin;
      if (i + 1 === r.viaje && id === r.solicitudId) {
        if (r.causa === "capacidad") expect(carga).toBeGreaterThan(u.capacidadKg);
        if (r.causa === "tipoNoAdmitido") expect(s.tiposUnidadAdmitidos).not.toContain(u.tipo);
        if (r.causa === "ventana") expect(inicios).toEqual([]);
        if (r.causa === "finDeTurno") {
          expect(inicios.length).toBeGreaterThan(0);
          expect(fin).toBeGreaterThan(e.parametros.turnoFinMin);
        }
        return;
      }
      expect(s.tiposUnidadAdmitidos).toContain(u.tipo);
      expect(carga).toBeLessThanOrEqual(u.capacidadKg);
      expect(inicios.length).toBeGreaterThan(0);
      expect(fin).toBeLessThanOrEqual(e.parametros.turnoFinMin);
      hora = fin;
      origen = s.ubicacion;
    }
    hora += minutosDeTraslado(distanciaKm(origen, e.parametros.patio, e.parametros.factorCircuidad), e.parametros.velocidadKmh) + e.parametros.descargaMin;
    if (i + 1 === r.viaje && r.solicitudId === null) {
      expect(r.causa).toBe("finDeTurno");
      expect(hora).toBeGreaterThan(e.parametros.turnoFinMin);
      return;
    }
    expect(hora).toBeLessThanOrEqual(e.parametros.turnoFinMin);
  }
  throw new Error("El rechazo no señala una causa en la ruta");
}

describe("recalcularRuta", () => {
  it("elimina vacíos, renumera y conserva la unidad sin visitas", () => {
    const e = entrada([solicitud("a"), solicitud("b")]);
    expect(recalcularRuta(e, "u1", [[], []])).toEqual({ ok: true, ruta: { unidadId: "u1", viajes: [] } });
    expect(recalcularRuta(e, "u1", [])).toEqual({ ok: true, ruta: { unidadId: "u1", viajes: [] } });
    const r = recalcularRuta(e, "u1", [[], ["a"], [], ["b"], []]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ruta.viajes.map(v => v.numero)).toEqual([1, 2]);
      expect(r.ruta.viajes.map(v => v.paradas[0].secuencia)).toEqual([1, 1]);
      expect(r.ruta.viajes[1].salidaMin).toBe(r.ruta.viajes[0].finDescargaMin);
    }
  });
  it("rechaza desconocidos, repetidos y entradas de re-ruteo", () => {
    const e = entrada();
    for (const [id, listas] of [["otra", []], ["u1", [["otra"]]], ["u1", [["s1"], ["s1"]]]] as [string, string[][]][])
      expect(recalcularRuta(e, id, listas)).toMatchObject({ error: "entrada_invalida" });
    expect(recalcularRuta({ ...e, solicitudes: [...e.solicitudes, ...e.solicitudes] }, "u1", [])).toMatchObject({ error: "entrada_invalida" });
    expect(recalcularRuta(entrada([], [unidad("u1", { cargaActualKg: 1 })]), "u1", [])).toMatchObject({ error: "entrada_invalida" });
    expect(recalcularRuta(entrada([], [unidad("u1", { ubicacionInicial: { lat: 0, lng: 0 } })]), "u1", [])).toMatchObject({ error: "entrada_invalida" });
  });
  it("cada rechazo tiene un testigo cierto, también en viajes posteriores", () => {
    fc.assert(fc.property(casos, fc.boolean(), (e, separados) => {
      const ids = e.solicitudes.map(s => s.id);
      const listas = separados ? ids.map(id => [id]) : [ids];
      const antes = structuredClone(e);
      const r = recalcularRuta(e, "u1", listas);
      expect(e).toEqual(antes);
      if (!r.ok) {
        expect(r.error).toBe("no_factible");
        if (r.error === "no_factible") comprobarRechazo(e, "u1", listas, r);
      } else {
        expect(r.ruta.viajes.flatMap(v => v.paradas.map(s => s.solicitudId))).toEqual(ids);
        expect(r.ruta.viajes.every(v => v.finDescargaMin <= e.parametros.turnoFinMin)).toBe(true);
      }
    }), { seed: 20261015, numRuns: 150 });
  });
  it("distingue servicio fuera de turno y descarga fuera de turno", () => {
    const e = entrada([solicitud("s", { tiempoServicioMin: 481 })]);
    expect(recalcularRuta(e, "u1", [["s"]])).toMatchObject({ causa: "finDeTurno", solicitudId: "s", viaje: 1 });
    e.solicitudes[0].tiempoServicioMin = 470;
    expect(recalcularRuta(e, "u1", [["s"]])).toMatchObject({ causa: "finDeTurno", solicitudId: null, viaje: 1 });
  });
});

describe("ajustarPlan", () => {
  it("pospone, recupera una pospuesta y permite vaciar la unidad conservando traza y contrafactual", () => {
    const e = entrada([solicitud("s", { ubicacion: { lat: patio.lat + 0.01, lng: patio.lng } })]);
    const p = generarPlan(e);
    const r = ajustarPlan(e, p, { tipo: "posponer", solicitudId: "s" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.rutas).toEqual([{ unidadId: "u1", viajes: [] }]);
    expect(r.plan.pospuestas).toEqual([{ solicitudId: "s", motivo: "pospuesta_a_mano", diagnostico: null }]);
    expect(r.plan.resumen).toMatchObject({ ruteadas: 0, pospuestas: 1, kmMetodoActual: 0, minutosTrasladoMetodoActual: 0 });
    expect(r.plan.traza).toEqual(p.traza);
    expect(validarPlan(e, r.plan, manual)).toEqual([]);
    expect(validarPlan(e, r.plan).length).toBeGreaterThan(0);
    const vuelta = ajustarPlan(e, r.plan, { tipo: "mover", solicitudId: "s", unidadId: "u1", viaje: 1, posicion: 1 });
    expect(vuelta.ok).toBe(true);
    if (vuelta.ok) expect(vuelta.plan).toEqual(p);
  });
  it("interpreta destino después de retirar, renumerando viajes y posiciones", () => {
    const e = entrada([solicitud("a", { cargaKg: 6000 }), solicitud("b", { cargaKg: 6000 })]);
    const p = generarPlan(e);
    const r = ajustarPlan(e, p, { tipo: "mover", solicitudId: "a", unidadId: "u1", viaje: 2, posicion: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(secuencias(r.plan)[0].viajes).toEqual([["b"], ["a"]]);
    const e2 = entrada([solicitud("a"), solicitud("b"), solicitud("c")]);
    const p2 = generarPlan(e2);
    const primero = p2.rutas[0].viajes[0].paradas[0].solicitudId;
    const movido = ajustarPlan(e2, p2, { tipo: "mover", solicitudId: primero, unidadId: "u1", viaje: 1, posicion: 3 });
    expect(movido.ok).toBe(true);
    if (movido.ok) expect(movido.plan.rutas[0].viajes[0].paradas[2].solicitudId).toBe(primero);
  });
  it("rechaza bloqueadas, destinos inválidos y horas que no avanzan", () => {
    const e = entrada([solicitud("s", { cargaKg: 9000 })]);
    const p = generarPlan(e);
    const ajustes: AjusteManual[] = [
      { tipo: "mover", solicitudId: "s", unidadId: "u1", viaje: 1, posicion: 1 },
      { tipo: "posponer", solicitudId: "s" }, { tipo: "posponer", solicitudId: "otra" },
      { tipo: "actualizarHora", instanteMin: 480 }, { tipo: "actualizarHora", instanteMin: NaN },
    ];
    for (const a of ajustes) expect(ajustarPlan(e, p, a)).toMatchObject({ error: "entrada_invalida" });
    const e2 = entrada();
    for (const cambio of [{ viaje: 0 }, { viaje: 3 }, { posicion: 0 }, { posicion: 2 }, { unidadId: "otra" }]) {
      expect(ajustarPlan(e2, generarPlan(e2), { tipo: "mover", solicitudId: "s1", unidadId: "u1", viaje: 1, posicion: 1, ...cambio }))
        .toMatchObject({ error: "entrada_invalida" });
    }
  });
  it("no fuerza una actualización que ya no alcanza la ventana", () => {
    const e = entrada([solicitud("s", { ventanas: [{ inicioMin: 480, finMin: 500 }] })]);
    const p = generarPlan(e);
    expect(ajustarPlan(e, p, { tipo: "actualizarHora", instanteMin: 501 })).toMatchObject({
      ok: false, error: "no_factible", causa: "ventana", unidadId: "u1", viaje: 1, solicitudId: "s",
    });
  });
  it("toda secuencia de ajustes aceptados pasa el oráculo; los rechazos no mutan", () => {
    fc.assert(fc.property(casos, fc.array(fc.record({ tipo: fc.integer({ min: 0, max: 2 }),
      s: fc.nat(30), u: fc.nat(3), v: fc.nat(8), lugar: fc.nat(12), avance: fc.integer({ min: 1, max: 90 }),
    }), { minLength: 1, maxLength: 15 }), (inicial, operaciones) => {
      let e = inicial;
      let p = generarPlan(e);
      for (const op of operaciones) {
        const id = e.solicitudes[op.s % e.solicitudes.length].id;
        const destino = p.rutas[op.u % p.rutas.length];
        const listas = destino.viajes.map(v => v.paradas.map(s => s.solicitudId).filter(s => s !== id)).filter(v => v.length);
        const viaje = op.v % (listas.length + 1) + 1;
        const ajuste: AjusteManual = op.tipo === 0 ? { tipo: "posponer", solicitudId: id }
          : op.tipo === 1 ? { tipo: "mover", solicitudId: id, unidadId: destino.unidadId, viaje,
            posicion: op.lugar % ((listas[viaje - 1]?.length ?? 0) + 1) + 1 }
          : { tipo: "actualizarHora", instanteMin: e.instanteMin + op.avance };
        const antes = structuredClone({ e, p });
        const r = ajustarPlan(e, p, ajuste);
        expect({ e, p }).toEqual(antes);
        expect(ajustarPlan(e, p, ajuste)).toEqual(r);
        if (r.ok) {
          expect(validarPlan(r.entrada, r.plan, manual)).toEqual([]);
          expect(r.plan.traza).toEqual(p.traza);
          if (ajuste.tipo === "actualizarHora") {
            expect(secuencias(r.plan)).toEqual(secuencias(p));
            expect(r.plan.rutas.flatMap(r => r.viajes).every(v => v.salidaMin >= ajuste.instanteMin)).toBe(true);
            expect(r.entrada.unidades.every(u => u.libreDesdeMin >= ajuste.instanteMin)).toBe(true);
          } else expect(r.entrada).toEqual(e);
          e = r.entrada; p = r.plan;
        } else if (r.error === "no_factible") {
          let nuevas = secuencias(p).find(ruta => ruta.unidadId === r.unidadId)!.viajes;
          let nuevaEntrada = e;
          if (ajuste.tipo === "actualizarHora") nuevaEntrada = { ...e, instanteMin: ajuste.instanteMin };
          else {
            nuevas = nuevas.map(v => v.filter(s => s !== ajuste.solicitudId)).filter(v => v.length);
            if (ajuste.tipo === "mover" && ajuste.unidadId === r.unidadId) {
              if (ajuste.viaje === nuevas.length + 1) nuevas.push([]);
              nuevas[ajuste.viaje - 1].splice(ajuste.posicion - 1, 0, ajuste.solicitudId);
            }
          }
          comprobarRechazo(nuevaEntrada, r.unidadId, nuevas, r);
        }
      }
    }), { seed: 727005, numRuns: 100 });
  });
});

it("mueve a otra unidad, conserva la vacía y actualiza horarios sin cambiar secuencias", () => {
  const e = entrada([solicitud("s")], [unidad("u1"), unidad("u2", { libreDesdeMin: 600 })]);
  const p = generarPlan(e);
  const movido = ajustarPlan(e, p, { tipo: "mover", solicitudId: "s", unidadId: "u2", viaje: 1, posicion: 1 });
  expect(movido.ok).toBe(true);
  if (!movido.ok) return;
  expect(movido.plan.rutas[0].viajes).toEqual([]);
  expect(movido.plan.rutas[1].viajes[0].salidaMin).toBe(600);
  const actualizado = ajustarPlan(e, movido.plan, { tipo: "actualizarHora", instanteMin: 620 });
  expect(actualizado.ok).toBe(true);
  if (!actualizado.ok) return;
  expect(secuencias(actualizado.plan)).toEqual(secuencias(movido.plan));
  expect(actualizado.plan.rutas[1].viajes[0]).toMatchObject({ salidaMin: 620, finDescargaMin: 655 });
  expect(actualizado.entrada.unidades.map(u => u.libreDesdeMin)).toEqual([620, 620]);
  expect(validarPlan(actualizado.entrada, actualizado.plan, manual)).toEqual([]);
});

it("señala la primera solicitud que rebasa capacidad y el viaje renumerado", () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 4000 }), fc.integer({ min: 1, max: 4000 }), (a, b) => {
    const e = entrada([solicitud("a", { cargaKg: a }), solicitud("b", { cargaKg: b })], [unidad("u1", { capacidadKg: a + b - 1 })]);
    const r = recalcularRuta(e, "u1", [[], ["a", "b"], []]);
    expect(r).toMatchObject({ ok: false, error: "no_factible", causa: "capacidad", viaje: 1, solicitudId: "b" });
    if (!r.ok && r.error === "no_factible") comprobarRechazo(e, "u1", [["a", "b"]], r);
  }), { seed: 727006, numRuns: 60 });
});
