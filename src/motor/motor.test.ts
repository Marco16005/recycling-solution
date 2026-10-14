import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { distanciaKm, generarPlan, minutosDeTraslado, validarPlan } from "./index";
import { entrada, patio, solicitud, unidad } from "./ejemplos.test-datos";
import type { EntradaPlan, Plan } from "./tipos";

const datosSolicitud = fc.record({
  x: fc.integer({ min: -50, max: 50 }), y: fc.integer({ min: -50, max: 50 }),
  carga: fc.integer({ min: 1, max: 14000 }), servicio: fc.integer({ min: 5, max: 120 }),
  registro: fc.integer({ min: 0, max: 59 }), tipo: fc.constantFrom("doble_rodada" as const, "rabon" as const, "camioneta" as const),
  ventanas: fc.array(fc.tuple(fc.integer({ min: 450, max: 950 }), fc.integer({ min: 1, max: 180 })), { minLength: 1, maxLength: 3 }),
});
const casos = fc.record({
  solicitudes: fc.array(datosSolicitud, { maxLength: 25 }),
  unidades: fc.array(fc.record({ tipo: fc.constantFrom("doble_rodada" as const, "rabon" as const, "camioneta" as const),
    capacidad: fc.integer({ min: 1000, max: 8000 }), carga: fc.integer({ min: 0, max: 1000 }),
    libre: fc.integer({ min: 480, max: 650 }), x: fc.integer({ min: -20, max: 20 }),
  }), { maxLength: 5 }),
  instante: fc.integer({ min: 480, max: 700 }), semilla: fc.integer(),
}).map(datos => {
  const e = entrada(datos.solicitudes.map((s, i) => solicitud(`s${String(i).padStart(2, "0")}`, {
    registradaEn: `2026-10-14T07:${String(s.registro).padStart(2, "0")}:00-06:00`,
    ubicacion: { lat: patio.lat + s.x / 1000, lng: patio.lng + s.y / 1000 }, cargaKg: s.carga,
    tiempoServicioMin: s.servicio, tiposUnidadAdmitidos: [s.tipo],
    ventanas: s.ventanas.map(([inicioMin, duracion]) => ({ inicioMin, finMin: inicioMin + duracion })),
  })), datos.unidades.map((u, i) => unidad(`u${i}`, { tipo: u.tipo, capacidadKg: u.capacidad,
    cargaActualKg: u.carga, libreDesdeMin: u.libre, ubicacionInicial: { lat: patio.lat + u.x / 1000, lng: patio.lng },
  })));
  e.instanteMin = datos.instante;
  e.parametros.semilla = datos.semilla;
  return e;
});

function comprobarPropiedades(e: EntradaPlan, p: Plan) {
  expect(validarPlan(e, p)).toEqual([]);
  const porId = new Map(e.solicitudes.map(s => [s.id, s]));
  const ids = [...p.pospuestas, ...p.bloqueadas].map(s => s.solicitudId);
  for (const ruta of p.rutas) {
    const u = e.unidades.find(u => u.id === ruta.unidadId)!;
    let finAnterior = Math.max(e.instanteMin, u.libreDesdeMin, e.parametros.turnoInicioMin);
    let origen = u.ubicacionInicial;
    if (u.cargaActualKg > 0) expect(ruta.viajes.length).toBeGreaterThan(0);
    for (const [indice, v] of ruta.viajes.entries()) {
      expect(v.numero).toBe(indice + 1);
      expect(v.salidaMin).toBeGreaterThanOrEqual(finAnterior);
      let hora = v.salidaMin;
      let carga = indice === 0 ? u.cargaActualKg : 0;
      for (const [posicion, parada] of v.paradas.entries()) {
        const s = porId.get(parada.solicitudId)!;
        ids.push(s.id);
        expect(parada.secuencia).toBe(posicion + 1);
        expect(s.tiposUnidadAdmitidos).toContain(u.tipo);
        carga += s.cargaKg;
        expect(s.ventanas).toContainEqual(parada.ventana);
        expect(parada.inicioServicioMin).toBeGreaterThanOrEqual(parada.ventana.inicioMin);
        expect(parada.inicioServicioMin).toBeLessThanOrEqual(parada.ventana.finMin);
        expect(parada.esperaMin).toBe(parada.inicioServicioMin - parada.llegadaMin);
        expect(parada.esperaMin).toBeGreaterThanOrEqual(0);
        expect(parada.llegadaMin).toBe(hora + minutosDeTraslado(distanciaKm(origen, s.ubicacion, e.parametros.factorCircuidad), e.parametros.velocidadKmh));
        expect(parada.finServicioMin).toBe(parada.inicioServicioMin + s.tiempoServicioMin);
        hora = parada.finServicioMin;
        origen = s.ubicacion;
      }
      expect(v.cargaKg).toBe(carga);
      expect(carga).toBeLessThanOrEqual(u.capacidadKg);
      expect(v.regresoPatioMin).toBe(hora + minutosDeTraslado(distanciaKm(origen, e.parametros.patio, e.parametros.factorCircuidad), e.parametros.velocidadKmh));
      expect(v.finDescargaMin).toBe(v.regresoPatioMin + e.parametros.descargaMin);
      expect(v.finDescargaMin).toBeLessThanOrEqual(e.parametros.turnoFinMin);
      origen = e.parametros.patio;
      finAnterior = v.finDescargaMin;
    }
  }
  expect(ids.sort()).toEqual(e.solicitudes.map(s => s.id).sort());
  expect(new Set(ids).size).toBe(ids.length);
  expect(p.traza.map(t => t.solicitudId)).toEqual([...e.solicitudes].sort((a, b) =>
    a.registradaEn.localeCompare(b.registradaEn) || a.folio.localeCompare(b.folio) || a.id.localeCompare(b.id)).map(s => s.id));
}

describe("Propiedades 1 a 9 del motor", () => {
  it("determinismo, partición, capacidad, ventanas, turno, compatibilidad, tiempos, FIFO y re-ruteo", () => {
    fc.assert(fc.property(casos, e => {
      const original = structuredClone(e);
      const plan = generarPlan(e);
      expect(generarPlan(e)).toEqual(plan);
      expect(e).toEqual(original);
      comprobarPropiedades(e, plan);
    }), { seed: 20261014, numRuns: 100 });
  });
  it("rechaza alteraciones de tiempos y de la historia sobre entradas generadas", () => {
    fc.assert(fc.property(casos, e => {
      const plan = generarPlan(e);
      const parada = plan.rutas.flatMap(r => r.viajes).flatMap(v => v.paradas)[0];
      if (parada) { parada.llegadaMin++; expect(validarPlan(e, plan).length).toBeGreaterThan(0); }
      const otro = generarPlan(e);
      if (otro.traza.length > 1) {
        [otro.traza[0], otro.traza[1]] = [otro.traza[1], otro.traza[0]];
        expect(validarPlan(e, otro).length).toBeGreaterThan(0);
      }
    }), { seed: 82, numRuns: 50 });
  });
});

describe("Casos límite y regresiones", () => {
  it("sin unidades y sin tipo compatible", () => {
    expect(generarPlan(entrada([solicitud()], [])).pospuestas[0].motivo).toBe("sin_unidades_disponibles");
    expect(generarPlan(entrada([solicitud()], [unidad("u", { tipo: "camioneta" })])).pospuestas[0].motivo).toBe("sin_unidad_compatible");
  });
  it("bloquea por máximo compatible del catálogo, no por otros tipos ni por la flota de hoy", () => {
    const e = entrada([solicitud("grande", { cargaKg: 9000 })], [unidad("rabon", { tipo: "rabon", capacidadKg: 12000 })]);
    expect(generarPlan(e).bloqueadas).toHaveLength(1);
    e.parametros.capacidadMaximaPorTipoKg.doble_rodada = 10000;
    expect(generarPlan(e).pospuestas[0].motivo).toBe("sin_unidad_compatible");
    e.unidades = [unidad("u", { capacidadKg: 8000 })];
    expect(generarPlan(e).pospuestas[0].diagnostico?.capacidad).toBeGreaterThan(0);
  });
  it("una parada: tiempos calculados a mano y servicio que termina después del cierre", () => {
    const e = entrada([solicitud("s", { ubicacion: { lat: 0, lng: 1 }, ventanas: [{ inicioMin: 600, finMin: 605 }], tiempoServicioMin: 20 })]);
    e.parametros.patio = { lat: 0, lng: 0 };
    e.unidades[0].ubicacionInicial = { lat: 0, lng: 0 };
    e.parametros.factorCircuidad = 1;
    e.parametros.velocidadKmh = 60;
    const v = generarPlan(e).rutas[0].viajes[0];
    // Un grado en el ecuador: 111.195 km, 112 min por tramo.
    expect(v.salidaMin).toBe(480);
    expect(v.paradas[0]).toMatchObject({ llegadaMin: 592, esperaMin: 8, inicioServicioMin: 600, finServicioMin: 620 });
    expect(v.regresoPatioMin).toBe(732);
    expect(v.finDescargaMin).toBe(747);
  });
  it("espera hasta apertura y elige la siguiente ventana aunque se reciban desordenadas", () => {
    const e = entrada([solicitud("s", { ventanas: [{ inicioMin: 600, finMin: 650 }, { inicioMin: 400, finMin: 450 }] })]);
    expect(generarPlan(e).rutas[0].viajes[0].paradas[0]).toMatchObject({ llegadaMin: 480, esperaMin: 120, inicioServicioMin: 600 });
  });
  it("ventana inalcanzable y turno que no alcanza para descargar", () => {
    expect(generarPlan(entrada([solicitud("s", { ventanas: [{ inicioMin: 400, finMin: 479 }] })])).pospuestas[0].diagnostico?.ventana).toBeGreaterThan(0);
    const e = entrada(); e.parametros.turnoFinMin = 514;
    expect(generarPlan(e).pospuestas[0].diagnostico?.finDeTurno).toBeGreaterThan(0);
  });
  it("recalcula el viaje 2 al insertar en el 1 y conserva su ventana", () => {
    const e = entrada([
      solicitud("a", { cargaKg: 6000, tiempoServicioMin: 10 }),
      solicitud("b", { cargaKg: 6000, tiempoServicioMin: 10, ventanas: [{ inicioMin: 505, finMin: 505 }] }),
      solicitud("c", { cargaKg: 2000, tiempoServicioMin: 20, ventanas: [{ inicioMin: 480, finMin: 500 }] }),
    ]);
    const p = generarPlan(e);
    expect(p.rutas[0].viajes).toHaveLength(2);
    expect(p.rutas[0].viajes[1].paradas[0].inicioServicioMin).toBe(505);
    expect(p.pospuestas[0]).toMatchObject({ solicitudId: "c", motivo: "sin_cupo" });
    expect(p.pospuestas[0].diagnostico?.afectaAOtra).toBeGreaterThan(0);
  });
  it("propaga un retraso factible al siguiente viaje sin alterar la instantánea previa", () => {
    const e = entrada([
      solicitud("a", { cargaKg: 6000, tiempoServicioMin: 10 }),
      solicitud("b", { cargaKg: 6000, tiempoServicioMin: 10 }),
      solicitud("c", { cargaKg: 2000, tiempoServicioMin: 20 }),
    ]);
    const p = generarPlan(e);
    const decision = p.traza[2];
    if (decision.resultado !== "admitida") throw new Error("Debe admitir c");
    expect(decision.viaje).toBe(1);
    expect(decision.rutasAntes[0].viajes[1].salidaMin).toBe(505);
    expect(p.rutas[0].viajes[1].salidaMin).toBe(525);
    expect(decision.rutasAntes[0].viajes[0].paradas.map(s => s.solicitudId)).toEqual(["a"]);
    expect(p.rutas[0].viajes[0].paradas.map(s => s.solicitudId)).toEqual(["c", "a"]);
  });
  it("el orden de los arreglos de entrada no altera zonas ni desempates", () => {
    const e = entrada([solicitud("b"), solicitud("a")], [unidad("z"), unidad("a")]);
    const p = generarPlan(e);
    expect(generarPlan({ ...e, solicitudes: [...e.solicitudes].reverse(), unidades: [...e.unidades].reverse() })).toEqual(p);
  });
  it("dos zonas con antigüedad cruzada: admite en FIFO global", () => {
    const e = entrada([
      solicitud("reciente-oeste", { registradaEn: "2026-10-14T08:00:00Z", ubicacion: { lat: 20.62, lng: -100.32 }, tiempoServicioMin: 80 }),
      solicitud("antigua-este", { registradaEn: "2026-10-14T07:00:00Z", ubicacion: { lat: 20.62, lng: -100.22 }, tiempoServicioMin: 80 }),
      solicitud("antigua-oeste", { registradaEn: "2026-10-14T07:01:00Z", ubicacion: { lat: 20.62, lng: -100.32 }, tiempoServicioMin: 80 }),
      solicitud("reciente-este", { registradaEn: "2026-10-14T08:01:00Z", ubicacion: { lat: 20.62, lng: -100.22 }, tiempoServicioMin: 80 }),
    ], [unidad("u1"), unidad("u2")]);
    // Cada visita sola termina en 480 + 14 + 80 + 14 + 15 = 603.
    // Dos visitas requieren al menos 683, aun compartiendo ubicación.
    e.parametros.turnoFinMin = 610;
    const p = generarPlan(e);
    expect(p.traza.map(t => [t.solicitudId, t.resultado])).toEqual([
      ["antigua-este", "admitida"], ["antigua-oeste", "admitida"], ["reciente-oeste", "pospuesta"], ["reciente-este", "pospuesta"],
    ]);
  });
  it("antigua grande pospuesta permite recientes pequeñas sin expulsar admitidas", () => {
    const e = entrada([solicitud("a", { cargaKg: 6000 }), solicitud("b", { cargaKg: 3000 }), solicitud("c", { cargaKg: 1000 })]);
    e.parametros.turnoFinMin = 540;
    const p = generarPlan(e);
    expect(p.traza.map(t => t.resultado)).toEqual(["admitida", "pospuesta", "admitida"]);
    expect(p.pospuestas[0].solicitudId).toBe("b");
  });
  it("instante a media mañana, unidad libre más tarde y regreso sin paradas", () => {
    const e = entrada([], [unidad("u", { cargaActualKg: 3000, libreDesdeMin: 700, ubicacionInicial: { lat: 20.63, lng: -100.27 } })]);
    e.instanteMin = 660;
    const p = generarPlan(e);
    expect(p.rutas[0].viajes[0]).toMatchObject({ salidaMin: 700, cargaKg: 3000, paradas: [] });
    expect(p.rutas[0].viajes[0].regresoPatioMin).toBeGreaterThan(700);
    expect(p.resumen.kmMetodoActual).toBe(0);
    e.solicitudes = [solicitud()];
    expect(generarPlan(e).rutas[0].viajes[0].salidaMin).toBe(700);
  });
  it("carga congelada llena: descarga vacía antes de abrir el siguiente viaje", () => {
    const p = generarPlan(entrada([solicitud()], [unidad("u", { cargaActualKg: 8000 })]));
    expect(p.rutas[0].viajes.map(v => v.cargaKg)).toEqual([8000, 1000]);
    expect(p.rutas[0].viajes[0].paradas).toEqual([]);
    expect(p.rutas[0].viajes[1].salidaMin).toBe(p.rutas[0].viajes[0].finDescargaMin);
  });
  it("rechaza repetidas y regreso obligatorio imposible", () => {
    expect(() => generarPlan(entrada([solicitud(), solicitud()]))).toThrow("repetidas");
    const e = entrada([], [unidad("u", { cargaActualKg: 1, libreDesdeMin: 960 })]);
    expect(() => generarPlan(e)).toThrow("regreso obligatorio");
  });
  it("ordena instantes con distintos desfases y desempata por folio e id", () => {
    const e = entrada([
      solicitud("z", { registradaEn: "2026-10-14T07:00:00-06:00", folio: "a" }),
      solicitud("a", { registradaEn: "2026-10-14T13:00:00Z", folio: "a" }),
      solicitud("b", { registradaEn: "2026-10-14T12:59:59.999Z", folio: "z" }),
    ]);
    expect(generarPlan(e).traza.map(t => t.solicitudId)).toEqual(["b", "a", "z"]);
  });
  it("60 solicitudes y 15 unidades en menos de un segundo, incluida validación", () => {
    const e = entrada(Array.from({ length: 60 }, (_, i) => solicitud(`s${String(i).padStart(2, "0")}`, {
      ubicacion: { lat: patio.lat + (i % 10) / 1000, lng: patio.lng + Math.floor(i / 10) / 1000 },
    })), Array.from({ length: 15 }, (_, i) => unidad(`u${i}`)));
    const inicio = performance.now();
    const p = generarPlan(e);
    const duracion = performance.now() - inicio;
    expect(p.resumen.ruteadas).toBe(60);
    expect(duracion).toBeLessThan(1000);
  });
});
