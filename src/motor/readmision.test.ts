import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { admitir } from "./admision";
import { casos } from "./casos.test-datos";
import { entrada, patio, solicitud, unidad } from "./ejemplos.test-datos";
import { ajustarPlan, generarPlan, recalcularRuta, tiempoMuerto, validarPlan } from "./index";
import { PRESUPUESTO_READMISION, readmitir } from "./reacomodo";
import type { Coordenada, DecisionReadmision, EntradaPlan, Plan, RestriccionesPlan, RutaPlan } from "./tipos";

// Plan 8, P8-3. Matriz explícita; km = minutos / 2.
//
// Patio P. Este: A, C y E (5 min entre sí). Oeste: B y D (5 min). P a cualquiera: 30. Este–oeste: 60.
// G: 30 desde P, 40 a A, C y E, 60 al oeste. H: P→H 30 y H→P 25 (no triangular), 5 a B y D, 60 al resto.
// Una unidad de 1600 kg; A, B, C y D de 700 kg en ese orden; E, G y H de 200 kg; turno de 08:00 a 14:05 (845).
//
// Fase 1 (S1): A,B en el viaje 1 y C,D en el 2, cada uno cruzando este y oeste: termina a las 830 con 15 min de holgura.
// Toda inserción en S1 agrega su servicio (20) más un traslado ≥ 0, así que E, G y H quedan sin cupo.
// Fase 2 (S2): {A,C} y {B,D}: termina a las 720, con 125 min de holgura y tiempo muerto 160.
// En S2: E junto a A y C agrega 5 min (Δ 5). G al principio o al final del viaje del este agrega 40 + 30 − 30 = 40
// (en medio, 75; en el del oeste, 60; en un viaje nuevo, 75): Δ mínimo 40. H al final del viaje del oeste:
// 5 + 25 − 30 = 0 (Δ 0).

const PUNTOS: Record<string, Coordenada> = {
  P: patio, A: { lat: 20.63, lng: -100.25 }, C: { lat: 20.631, lng: -100.25 }, E: { lat: 20.632, lng: -100.25 },
  B: { lat: 20.63, lng: -100.29 }, D: { lat: 20.631, lng: -100.29 }, G: { lat: 20.6, lng: -100.27 }, H: { lat: 20.633, lng: -100.29 },
};
const ESTE = new Set(["A", "C", "E"]), OESTE = new Set(["B", "D"]);
function minutos(a: string, b: string): number {
  if (a === "H" && b === "P") return 25;
  if (a === "P" || b === "P") return 30;
  if (a === "H" || b === "H") return OESTE.has(a) || OESTE.has(b) ? 5 : 60;
  if (a === "G" || b === "G") return ESTE.has(a) || ESTE.has(b) ? 40 : 60;
  return (ESTE.has(a) && ESTE.has(b)) || (OESTE.has(a) && OESTE.has(b)) ? 5 : 60;
}
const registro = (n: number) => `2026-10-14T07:0${n}:00-06:00`;

/** Las cuatro esquinas más las pospuestas pedidas, registradas en ese orden después de D. */
function dia(extras: string[], tolerancia = 15): EntradaPlan {
  const ids = ["A", "B", "C", "D", ...extras];
  const e = entrada(ids.map((id, i) => solicitud(id, { ubicacion: PUNTOS[id], registradaEn: registro(i), cargaKg: i < 4 ? 700 : 200 })),
    [unidad("u1", { capacidadKg: 1600 })]);
  e.parametros.turnoFinMin = 845;
  e.parametros.toleranciaReadmisionMin = tolerancia;
  const nombres = ["P", ...ids];
  const min = nombres.map(a => nombres.map(b => a === b ? 0 : minutos(a, b)));
  e.traslados = { puntos: nombres.map(n => PUNTOS[n]), km: min.map(f => f.map(m => m / 2)), minLibres: min,
    ajusteM: nombres.map(() => 0), aproximados: [], mapa: "sintética" };
  return e;
}
const decision = (plan: Plan, id: string) => plan.reacomodo!.readmision.find(d => d.solicitudId === id)!;
/** Copia como la guarda la base (JSON): sin referencias compartidas entre rutasAntes y las rutas. */
const copia = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const atendidas = (rutas: RutaPlan[]) => rutas.flatMap(r => r.viajes.flatMap(v => v.paradas.map(p => p.solicitudId))).sort();

describe("readmisión (fase 3)", () => {
  it("una pospuesta sin cupo en la fase 1 cabe tras el reacomodo y entra con su Δ", () => {
    const e = dia(["E"]);
    expect(admitir(e).pospuestas).toEqual([expect.objectContaining({ solicitudId: "E", motivo: "sin_cupo" })]);
    const plan = generarPlan(e);
    expect(validarPlan(e, plan)).toEqual([]);
    expect(decision(plan, "E")).toMatchObject({ resultado: "admitida", deltaMin: 5, movida: null });
    expect(plan.pospuestas).toEqual([]);
    expect(atendidas(plan.rutas)).toEqual(["A", "B", "C", "D", "E"]);
    expect(plan.reacomodo!.antes.ruteadas).toBe(4);
    expect(plan.resumen.ruteadas).toBe(5);
    // S2 (160) + 5 de E; la fase 4 no puede empeorarlo.
    expect(plan.resumen.tiempoMuertoMin).toBeLessThanOrEqual(165);
  });

  it("una que cabría con Δ 40 queda alarga_la_jornada con diagnostico.deltaMinimoMin = 40", () => {
    const e = dia(["G"]);
    const plan = generarPlan(e);
    expect(validarPlan(e, plan)).toEqual([]);
    expect(decision(plan, "G")).toMatchObject({ resultado: "pospuesta", motivo: "alarga_la_jornada", diagnostico: { deltaMinimoMin: 40 } });
    expect(plan.pospuestas).toEqual([{ solicitudId: "G", motivo: "alarga_la_jornada", diagnostico: expect.objectContaining({ deltaMinimoMin: 40 }) }]);
  });

  it("tolerancia 0: solo entra lo de Δ ≤ 0; el resto queda alarga_la_jornada con su Δ real", () => {
    const e = dia(["E", "H"], 0);
    const plan = generarPlan(e);
    expect(validarPlan(e, plan)).toEqual([]);
    expect(decision(plan, "E")).toMatchObject({ resultado: "pospuesta", motivo: "alarga_la_jornada", diagnostico: { deltaMinimoMin: 5 } });
    expect(decision(plan, "H")).toMatchObject({ resultado: "admitida", deltaMin: 0 });
    expect(plan.pospuestas.map(p => [p.solicitudId, p.motivo])).toEqual([["E", "alarga_la_jornada"]]);
  });

  it("orden FIFO: la antigua que no cabe se decide antes que la nueva que sí, y su decisión queda primero", () => {
    const e = dia(["G", "E"]);
    const plan = generarPlan(e);
    expect(validarPlan(e, plan)).toEqual([]);
    expect(plan.reacomodo!.readmision.map(d => [d.solicitudId, d.resultado])).toEqual([["G", "pospuesta"], ["E", "admitida"]]);
    // G no entró: E decide sobre el mismo estado que G.
    expect(decision(plan, "E").rutasAntes).toEqual(decision(plan, "G").rutasAntes);
    expect(decision(plan, "G").rutasAntes).toEqual(plan.reacomodo!.rutasReacomodadas);
  });

  it("sin_unidades_disponibles y sin_unidad_compatible no se reintentan", () => {
    const e = dia(["E"]);
    e.solicitudes.push(solicitud("K", { ubicacion: PUNTOS.A, registradaEn: registro(8), cargaKg: 100, tiposUnidadAdmitidos: ["camioneta"] }));
    const plan = generarPlan(e);
    expect(plan.reacomodo!.readmision.map(d => d.solicitudId)).toEqual(["E"]);
    expect(plan.pospuestas).toEqual([{ solicitudId: "K", motivo: "sin_unidad_compatible", diagnostico: null }]);
    const sinUnidades = { ...dia(["E"]), unidades: [] };
    const vacio = generarPlan(sinUnidades);
    expect(vacio.reacomodo!.readmision).toEqual([]);
    expect(vacio.pospuestas.every(p => p.motivo === "sin_unidades_disponibles")).toBe(true);
  });
});

// Todos en el este, a 5 min entre sí y 30 del patio. u1 (doble rodada) y u2 (rabón), de 1000 kg; 500 kg cada solicitud.
// A y E solo admiten doble rodada; F solo rabón; C, las dos. Servicio de 5 min y turno de 08:00 a 10:40 (640): cabe un
// viaje por unidad (90 min con dos paradas: termina a las 570) pero no un segundo (otros 80).
// Fase 1: u1 = {A, C} (lleno), u2 = {F}; E no cabe (capacidad en u1 y fin de turno en un viaje nuevo).
// Mover C a u2 (u2 = {F, C}: termina a las 570 en vez de 560, +10, dentro de la tolerancia) y meter E en u1:
// tiempo muerto 155 → 160, Δ conjunto 5. Mover C sola no mejora (155 = 155).
function escenario(restricciones?: RestriccionesPlan) {
  const este = (i: number) => ({ lat: 20.63 + i / 1000, lng: -100.25 });
  const e = entrada([
    solicitud("A", { ubicacion: este(0), registradaEn: registro(0), cargaKg: 500, tiempoServicioMin: 5 }),
    solicitud("C", { ubicacion: este(1), registradaEn: registro(1), cargaKg: 500, tiempoServicioMin: 5, tiposUnidadAdmitidos: ["doble_rodada", "rabon"] }),
    solicitud("F", { ubicacion: este(2), registradaEn: registro(2), cargaKg: 500, tiempoServicioMin: 5, tiposUnidadAdmitidos: ["rabon"] }),
    solicitud("E", { ubicacion: este(3), registradaEn: registro(3), cargaKg: 500, tiempoServicioMin: 5 }),
  ], [unidad("u1", { capacidadKg: 1000 }), unidad("u2", { tipo: "rabon", capacidadKg: 1000 })]);
  e.parametros.turnoFinMin = 640;
  const puntos = [patio, este(0), este(1), este(2), este(3)];
  const min = puntos.map((_, i) => puntos.map((_, j) => i === j ? 0 : i === 0 || j === 0 ? 30 : 5));
  e.traslados = { puntos, km: min.map(f => f.map(m => m / 2)), minLibres: min, ajusteM: puntos.map(() => 0), aproximados: [], mapa: "sintética" };
  return { e, restricciones };
}


describe('"mover una y meter"', () => {
  it("una que solo cabe moviendo una parada entra con la movida registrada (de, a) y Δ conjunto ≤ tolerancia", () => {
    const { e } = escenario();
    expect(admitir(e).pospuestas.map(p => [p.solicitudId, p.motivo])).toEqual([["E", "sin_cupo"]]);
    const plan = generarPlan(e);
    expect(validarPlan(e, plan)).toEqual([]);
    const d = decision(plan, "E") as Extract<DecisionReadmision, { resultado: "admitida" }>;
    expect(d).toMatchObject({ resultado: "admitida", deltaMin: 5, posicion: { unidadId: "u1", viaje: 1 } });
    expect(d.movida).toMatchObject({ solicitudId: "C", de: { unidadId: "u1", viaje: 1 }, a: { unidadId: "u2", viaje: 1 } });
    expect(plan.reacomodo!.movimientos.fase2).toBe(0);
    expect(plan.pospuestas).toEqual([]);
  });

  it("la validación rechaza un movimiento que alarga una unidad más de la tolerancia", () => {
    // El mismo plan (C movida alarga u2 10 min), validado con tolerancia 5.
    const { e } = escenario();
    const plan = generarPlan(e);
    expect(decision(plan, "E")).toMatchObject({ resultado: "admitida", deltaMin: 5 });
    expect(validarPlan({ ...e, parametros: { ...e.parametros, toleranciaReadmisionMin: 5 } }, plan)).toContain("Readmisión: u2 termina más de la tolerancia después");
  });

  it('"mover una y meter" nunca mueve una protegida', () => {
    const { e, restricciones } = escenario({ admitidas: { u1: [["C"]] } });
    const plan = generarPlan(e, restricciones);
    expect(validarPlan(e, plan, { restricciones })).toEqual([]);
    // C está protegida y A solo admite doble rodada: E no tiene lugar ni directo ni moviendo una.
    expect(decision(plan, "E")).toMatchObject({ resultado: "pospuesta", motivo: "sin_cupo" });
  });
});

describe('"mover una y meter" con la inserción en otra unidad (revisión de Codex)', () => {
  // u1 = [X] y u2 = [Y], ambas de doble rodada; G solo admite rabón (u3, vacía). Patio a X, Y: 30; X–Y: 5; patio a G:
  // 20; servicio 5 y descarga 15. Tiempo muerto: X y Y solas, 75 cada una; juntas en u2, 30 + 5 + 30 + 15 = 80: ahorra
  // 70, y u2 termina a las 570 en vez de 560 (+10). G en un viaje nuevo de u3: 20 + 20 + 15 = 55 > 15, sin directa
  // dentro de la tolerancia. Mover X junto a Y y meter G en u3: Δ conjunto −70 + 55 = −15.
  // Se llama a readmitir sobre un estado que no es óptimo a propósito (en generarPlan la fase 2 ya los habría juntado).
  function escenarioOtraUnidad(tolerancia: number) {
    const lugar = (i: number) => ({ lat: 20.7 + i / 1000, lng: -100.2 });
    const e = entrada([
      solicitud("X", { ubicacion: lugar(0), tiempoServicioMin: 5, registradaEn: registro(0), cargaKg: 100 }),
      solicitud("Y", { ubicacion: lugar(1), tiempoServicioMin: 5, registradaEn: registro(1), cargaKg: 100 }),
      solicitud("G", { ubicacion: lugar(2), tiempoServicioMin: 5, registradaEn: registro(2), cargaKg: 100, tiposUnidadAdmitidos: ["rabon"] }),
    ], [unidad("u1"), unidad("u2"), unidad("u3", { tipo: "rabon" })]);
    e.parametros.toleranciaReadmisionMin = tolerancia;
    const puntos = [patio, lugar(0), lugar(1), lugar(2)];
    const min = puntos.map((_, i) => puntos.map((_, j) => i === j ? 0 : (i === 3 || j === 3) ? (i === 0 || j === 0 ? 20 : 60) : (i === 0 || j === 0 ? 30 : 5)));
    e.traslados = { puntos, km: min.map(f => f.map(m => m / 2)), minLibres: min, ajusteM: puntos.map(() => 0), aproximados: [], mapa: "sintética" };
    const ruta = (u: string, v: string[][]) => { const r = recalcularRuta(e, u, v); if (!r.ok) throw new Error("ruta"); return r.ruta; };
    return { e, rutas: [ruta("u1", [["X"]]), ruta("u2", [["Y"]]), ruta("u3", [])], porId: new Map(e.solicitudes.map(x => [x.id, x])) };
  }

  it("un movimiento que ahorra en otras unidades le hace lugar a la pospuesta en una tercera", () => {
    const { e, rutas, porId } = escenarioOtraUnidad(15);
    const r = readmitir(e, rutas, porId, undefined, ["G"], 15, PRESUPUESTO_READMISION);
    expect(r.decisiones[0]).toMatchObject({ resultado: "admitida", deltaMin: -15, posicion: { unidadId: "u3", viaje: 1, secuencia: 1 },
      movida: { solicitudId: "X", de: { unidadId: "u1" }, a: { unidadId: "u2" } } });
    expect(tiempoMuerto(e, r.rutas)).toBe(tiempoMuerto(e, rutas) - 15);
  });

  it("con tolerancia 5 el movimiento alargaría u2 10 min: no se hace y G queda alarga_la_jornada con su Δ directo", () => {
    const { e, rutas, porId } = escenarioOtraUnidad(5);
    const r = readmitir(e, rutas, porId, undefined, ["G"], 5, PRESUPUESTO_READMISION);
    expect(r.decisiones[0]).toMatchObject({ resultado: "pospuesta", motivo: "alarga_la_jornada", diagnostico: { deltaMinimoMin: 55 } });
    expect(r.rutas).toEqual(rutas);
  });
});

describe("validación de la readmisión (§4.6, pasos 3 y 6)", () => {
  it("rechaza readmisión fuera de orden, con una decisión de más o de menos y con rutasAntes alterado", () => {
    const e = dia(["G", "E"]);
    const plan = generarPlan(e);
    const desordenada = copia(plan);
    desordenada.reacomodo!.readmision.reverse();
    expect(validarPlan(e, desordenada)).toContain("Readmisión: no hay exactamente una decisión por pospuesta sin cupo, en orden FIFO");
    const sinUna = copia(plan);
    sinUna.reacomodo!.readmision.pop();
    expect(validarPlan(e, sinUna)).toContain("Readmisión: no hay exactamente una decisión por pospuesta sin cupo, en orden FIFO");
    const deMas = copia(plan);
    deMas.reacomodo!.readmision.push(copia(deMas.reacomodo!.readmision[0]));
    expect(validarPlan(e, deMas)).toContain("Readmisión: no hay exactamente una decisión por pospuesta sin cupo, en orden FIFO");
    const alterada = copia(plan);
    alterada.reacomodo!.readmision[1].rutasAntes[0].viajes[0].km += 1;
    expect(validarPlan(e, alterada)).toContain("Readmisión: la decisión de E altera las rutas anteriores");
  });

  it("rechaza un Δ excedido y una alarga_la_jornada cuyo Δ mínimo real está dentro de la tolerancia", () => {
    const conE = dia(["E"]);
    const plan = generarPlan(conE);
    expect(validarPlan({ ...conE, parametros: { ...conE.parametros, toleranciaReadmisionMin: 0 } }, plan)).toContain("Readmisión: E excede la tolerancia");
    const otroDelta = copia(plan);
    (otroDelta.reacomodo!.readmision[0] as Extract<DecisionReadmision, { resultado: "admitida" }>).deltaMin = 4;
    expect(validarPlan(conE, otroDelta)).toContain("Readmisión: el Δ de E no coincide");
    const conG = dia(["G"]);
    const alarga = generarPlan(conG);
    expect(validarPlan({ ...conG, parametros: { ...conG.parametros, toleranciaReadmisionMin: 45 } }, alarga))
      .toContain("Readmisión: G alarga la jornada con un Δ mínimo distinto del real o dentro de la tolerancia");
  });

  it('rechaza un "mover una y meter" que mueve una protegida', () => {
    // El plan de "mover una y meter" (C pasó de u1 a u2 para meter a E), validado como si C estuviera protegida en u1.
    const { e } = escenario();
    const plan = generarPlan(e);
    expect(validarPlan(e, plan, { restricciones: { admitidas: { u1: [["C"]] } } }))
      .toContain('Readmisión: "mover una y meter" movió una protegida (C)');
  });
});

describe("ajustes manuales sobre un 1.2.0 (§4.8)", () => {
  it("mover, posponer y actualizar hora conservan reacomodo intacto (con despues), recalculan el tiempo muerto y validan en modo manual", () => {
    const e = dia(["E"]);
    const plan = generarPlan(e);
    const ajustes = [
      { tipo: "posponer" as const, solicitudId: "E" },
      { tipo: "mover" as const, solicitudId: "E", unidadId: "u1", viaje: 3, posicion: 1 },
      { tipo: "actualizarHora" as const, instanteMin: 490 },
    ];
    for (const ajuste of ajustes) {
      const r = ajustarPlan(e, plan, ajuste);
      expect(r).toMatchObject({ ok: true });
      if (!r.ok) continue;
      expect(r.plan.versionMotor).toBe("1.2.0");
      expect(r.plan.reacomodo).toEqual(plan.reacomodo);
      expect(r.plan.resumen.tiempoMuertoMin).toBe(tiempoMuerto(r.entrada, r.plan.rutas));
      expect(validarPlan(r.entrada, r.plan, { ajustadoAMano: true })).toEqual([]);
      // Se vuelve a ajustar.
      const otra = ajustarPlan(r.entrada, r.plan, { tipo: "actualizarHora", instanteMin: 495 });
      expect(otra).toMatchObject({ ok: true });
    }
  });
});

describe("propiedades y rendimiento de la readmisión", () => {
  it("generadores del Plan 3 con tolerancia al azar: cada readmitida con Δ ≤ tolerancia, S1 ⊆ S4 y plan válido", () => {
    fc.assert(fc.property(casos, fc.integer({ min: 0, max: 60 }), (e, tolerancia) => {
      e.parametros.toleranciaReadmisionMin = tolerancia;
      const plan = generarPlan(e), f1 = admitir(e);
      expect(validarPlan(e, plan)).toEqual([]);
      for (const d of plan.reacomodo!.readmision) if (d.resultado === "admitida") expect(d.deltaMin).toBeLessThanOrEqual(tolerancia);
      const finales = new Set(atendidas(plan.rutas));
      for (const id of atendidas(f1.rutas)) expect(finales.has(id)).toBe(true);
      expect(generarPlan(e)).toEqual(plan);
    }), { seed: 20261029, numRuns: 100 });
  });

  it("40 solicitudes y 2 unidades chicas: menos de 2000 ms con validación, y dos corridas dan el mismo plan", () => {
    const e = entrada(Array.from({ length: 40 }, (_, i) => solicitud(`s${String(i).padStart(2, "0")}`, {
      ubicacion: { lat: patio.lat + (i % 8) / 100, lng: patio.lng + Math.floor(i / 8) / 100 }, cargaKg: 600, tiempoServicioMin: 15,
      registradaEn: `2026-10-14T07:${String(i).padStart(2, "0")}:00-06:00`,
    })), [unidad("u1", { capacidadKg: 1500 }), unidad("u2", { capacidadKg: 1500 })]);
    e.parametros.turnoFinMin = 780;
    const inicio = performance.now();
    const plan = generarPlan(e);
    const ms = performance.now() - inicio;
    // Muchas pospuestas: cada una pasa por la inserción directa y "mover una y meter" con su presupuesto.
    expect(plan.reacomodo!.readmision.length).toBeGreaterThan(20);
    expect(ms).toBeLessThan(2000);
    expect(generarPlan(e)).toEqual(plan);
  });
});
