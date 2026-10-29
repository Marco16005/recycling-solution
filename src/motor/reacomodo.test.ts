import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import * as calculo from "./calculo";
import { admitir } from "./admision";
import { casos } from "./casos.test-datos";
import { entrada, patio, solicitud, unidad } from "./ejemplos.test-datos";
import { generarPlan, recalcularRuta, tiempoMuerto, validarPlan } from "./index";
import { reacomodar } from "./reacomodo";
import type { Coordenada, EntradaPlan, Plan, RutaPlan, SolicitudMotor } from "./tipos";

// Plan 8, P8-2. Matrices explícitas: cada prueba dice sus minutos libres; km = minutos / 2.

// El cálculo real, espiado: así se comprueba que evaluaciones cuenta las rutas recalculadas de verdad.
vi.mock("./calculo", async (original) => {
  const real = await original<typeof import("./calculo")>();
  return { ...real, calcular: vi.fn(real.calcular) };
});

const ESTE = { lat: 20.63, lng: -100.25 }, ESTE2 = { lat: 20.631, lng: -100.25 };
const OESTE = { lat: 20.63, lng: -100.29 }, OESTE2 = { lat: 20.631, lng: -100.29 };

/** Matriz dirigida sobre los puntos, con minutos(i, j) para i ≠ j. */
function conMatriz(e: EntradaPlan, puntos: Coordenada[], minutos: (i: number, j: number) => number): EntradaPlan {
  const min = puntos.map((_, i) => puntos.map((_, j) => i === j ? 0 : minutos(i, j)));
  e.traslados = { puntos, km: min.map(f => f.map(m => m / 2)), minLibres: min, ajusteM: puntos.map(() => 0), aproximados: [], mapa: "sintética" };
  return e;
}
const registro = (n: number) => `2026-10-14T07:0${n}:00-06:00`;
const secuencias = (r: RutaPlan) => r.viajes.map(v => v.paradas.map(p => p.solicitudId));
const conjuntos = (r: RutaPlan) => secuencias(r).map(v => [...v].sort()).sort((a, b) => a.join().localeCompare(b.join()));
const atendidas = (rutas: RutaPlan[]) => rutas.flatMap(secuencias).flat().sort();
const km = (rutas: RutaPlan[]) => rutas.reduce((a, r) => a + r.viajes.reduce((b, v) => b + v.km, 0), 0);

/**
 * Patio P; A y C al este, B y D al oeste. P a cualquier cliente: 30 min. A–C y B–D: 5. Este–oeste: 60.
 * Una unidad de 1600 kg y cuatro solicitudes de 800 kg (dos por viaje) en orden A, B, C, D.
 */
function cuatroEsquinas(tipos: SolicitudMotor["tiposUnidadAdmitidos"] = ["doble_rodada"]) {
  const puntos = [patio, ESTE, OESTE, ESTE2, OESTE2];
  const s = ["A", "B", "C", "D"].map((id, i) => solicitud(id, { ubicacion: puntos[i + 1], registradaEn: registro(i), cargaKg: 800, tiposUnidadAdmitidos: tipos }));
  const lado = (i: number) => (i === 1 || i === 3 ? "este" : "oeste");
  const minutos = (i: number, j: number) => (i === 0 || j === 0 ? 30 : lado(i) === lado(j) ? 5 : 60);
  return { s, puntos, minutos };
}

describe("tiempo muerto y reacomodo (fases 2 y 4)", () => {
  it("la admisión cruza este y oeste en cada viaje; el reacomodo los separa y el tiempo muerto baja exactamente 110 min", () => {
    const { s, puntos, minutos } = cuatroEsquinas();
    const e = conMatriz(entrada(s, [unidad("u1", { capacidadKg: 1600 })]), puntos, minutos);
    const f1 = admitir(e);
    // Cada viaje de la admisión mezcla un cliente del este y uno del oeste: 30 + 60 + 30 de traslado.
    expect(conjuntos(f1.rutas[0])).toEqual([["A", "B"], ["C", "D"]]);
    const plan = generarPlan(e);
    expect(validarPlan(e, plan)).toEqual([]);
    expect(conjuntos(plan.rutas[0])).toEqual([["A", "C"], ["B", "D"]]);
    // S1: 2 × (120 de traslado + 15 de descarga) = 270. S4: 2 × (65 + 15) = 160.
    expect(plan.reacomodo!.antes.tiempoMuertoMin).toBe(270);
    expect(plan.resumen.tiempoMuertoMin).toBe(160);
    expect(plan.reacomodo!.antes.tiempoMuertoMin - plan.resumen.tiempoMuertoMin!).toBe(110);
    expect(plan.reacomodo!.movimientos.fase2).toBeGreaterThan(0);
    expect(plan.reacomodo!.movimientos.fase4).toBe(0);
    expect(plan.reacomodo!.rutasReacomodadas).toEqual(plan.rutas);
    expect(plan.traza).toEqual(f1.traza);
    expect(plan.reacomodo!.antes).toEqual({ ...f1.resumen, tiempoMuertoMin: 270 });
    expect(plan.reacomodo!.despues).toEqual(plan.resumen);
  });

  it("tiempoMuerto usa el inicio efectivo max(instante, libreDesde, turnoInicio); una unidad sin viajes aporta 0; el regreso obligatorio con carga aporta traslado y descarga", () => {
    const e = conMatriz(entrada([solicitud("a", { ubicacion: ESTE, tiempoServicioMin: 20 })],
      [unidad("u1", { libreDesdeMin: 520 }), unidad("u2", { libreDesdeMin: 480 })]), [patio, ESTE], () => 30);
    e.instanteMin = 500;
    const plan = generarPlan(e);
    const [u1, u2] = plan.rutas;
    // La admisión elige la unidad que termina antes (u2 empieza a las 500): 500 + 30 + 20 + 30 + 15 = 595.
    const usada = u1.viajes.length ? u1 : u2, libre = u1.viajes.length ? u2 : u1;
    expect(libre.viajes).toEqual([]);
    const inicio = usada.unidadId === "u1" ? 520 : 500;
    expect(tiempoMuerto(e, [usada])).toBe(usada.viajes[0].finDescargaMin - inicio - 20);
    expect(tiempoMuerto(e, [libre])).toBe(0);
    expect(tiempoMuerto(e, plan.rutas)).toBe(75);
    const conCarga = conMatriz(entrada([], [unidad("u1", { ubicacionInicial: ESTE, cargaActualKg: 500 })]), [patio, ESTE], () => 30);
    const regreso = generarPlan(conCarga);
    expect(regreso.rutas[0].viajes).toHaveLength(1);
    expect(regreso.resumen.tiempoMuertoMin).toBe(45);   // 30 de regreso + 15 de descarga
    expect(validarPlan(conCarga, regreso)).toEqual([]);
  });

  it("un movimiento con el mismo tiempo muerto y los mismos km no se acepta ni cuenta en movimientos", () => {
    const e = conMatriz(entrada([solicitud("A", { ubicacion: ESTE, registradaEn: registro(0) }), solicitud("C", { ubicacion: ESTE2, registradaEn: registro(1) })]),
      [patio, ESTE, ESTE2], (i, j) => (i === 0 || j === 0 ? 30 : 5));
    const plan = generarPlan(e);
    // C,A y A,C cuestan lo mismo: el reacomodo no cambia nada.
    expect(plan.reacomodo!.movimientos).toEqual({ fase2: 0, fase4: 0 });
    expect(plan.rutas).toEqual(admitir(e).rutas);
    expect(plan.reacomodo!.rutasReacomodadas).toEqual(plan.rutas);
  });

  it("nada que mejorar: una unidad con una solicitud, y un día sin solicitudes", () => {
    for (const e of [entrada([solicitud("a", { ubicacion: ESTE })]), entrada([])]) {
      const plan = generarPlan(e);
      const f1 = admitir(e);
      expect(validarPlan(e, plan)).toEqual([]);
      expect(plan.versionMotor).toBe("1.2.0");
      expect(plan.reacomodo!.movimientos).toEqual({ fase2: 0, fase4: 0 });
      expect(plan.reacomodo!.rutasReacomodadas).toEqual(f1.rutas);
      expect(plan.rutas).toEqual(f1.rutas);
      expect(plan.reacomodo!.readmision).toEqual([]);
      expect(plan.reacomodo!.antes).toEqual(plan.reacomodo!.despues);
    }
    expect(generarPlan(entrada([])).resumen.tiempoMuertoMin).toBe(0);
  });

  it("protegidas: no se invierten ni se mueven de unidad, aunque convenga; la unidad protegida no cambia y la otra sí", () => {
    const { s, puntos, minutos } = cuatroEsquinas(["rabon"]);
    const X = { lat: 20.6, lng: -100.27 }, Y = { lat: 20.601, lng: -100.27 };
    const todos = [...puntos, X, Y];
    // X→Y 60 e Y→X 5: invertir X,Y ahorraría 55 min. P–X 30, P–Y 30.
    const e = conMatriz(entrada([...s, solicitud("X", { ubicacion: X, registradaEn: registro(8), tiposUnidadAdmitidos: ["doble_rodada", "rabon"] }),
      solicitud("Y", { ubicacion: Y, registradaEn: registro(9), tiposUnidadAdmitidos: ["doble_rodada", "rabon"] })],
      [unidad("u1"), unidad("u2", { tipo: "rabon", capacidadKg: 1600 })]), todos, (i, j) => {
      if (i >= 5 || j >= 5) return i === 5 && j === 6 ? 60 : i === 6 && j === 5 ? 5 : 30;
      return minutos(i, j);
    });
    const restricciones = { admitidas: { u1: [["X", "Y"]] } };
    const plan = generarPlan(e, restricciones);
    expect(validarPlan(e, plan, { restricciones })).toEqual([]);
    expect(secuencias(plan.rutas[0])).toEqual([["X", "Y"]]);
    expect(secuencias(plan.reacomodo!.rutasReacomodadas[0])).toEqual([["X", "Y"]]);
    expect(conjuntos(plan.rutas[1])).toEqual([["A", "C"], ["B", "D"]]);
  });

  it("nunca mueve una parada a una unidad de tipo no admitido, aunque convenga; ningún viaje queda vacío", () => {
    // A y S solo admiten doble rodada (u1); B solo rabón (u2). S está junto a B (5 min) y lejos de A (60).
    const S = ESTE2;
    const e = conMatriz(entrada([solicitud("A", { ubicacion: OESTE, registradaEn: registro(0) }),
      solicitud("B", { ubicacion: ESTE, registradaEn: registro(1), tiposUnidadAdmitidos: ["rabon"] }),
      solicitud("S", { ubicacion: S, registradaEn: registro(2) })],
      [unidad("u1"), unidad("u2", { tipo: "rabon" })]), [patio, OESTE, ESTE, S], (i, j) => (i === 0 || j === 0 ? 30 : i === 1 || j === 1 ? 60 : 5));
    const plan = generarPlan(e);
    expect(validarPlan(e, plan)).toEqual([]);
    expect(atendidas([plan.rutas[0]])).toEqual(["A", "S"]);
    expect(secuencias(plan.rutas[1])).toEqual([["B"]]);
    expect(plan.reacomodo!.movimientos).toEqual({ fase2: 0, fase4: 0 });
    for (const rutas of [plan.rutas, plan.reacomodo!.rutasReacomodadas]) for (const r of rutas) for (const v of r.viajes) expect(v.paradas.length).toBeGreaterThan(0);
  });

  it("presupuesto agotado a mitad de un vecindario: no lo rebasa, no empeora y dos corridas dan lo mismo", () => {
    const { s, puntos, minutos } = cuatroEsquinas();
    const e = conMatriz(entrada(s, [unidad("u1", { capacidadKg: 1600 })]), puntos, minutos);
    const f1 = admitir(e);
    const porId = new Map(e.solicitudes.map(x => [x.id, x]));
    const inicial = { tm: tiempoMuerto(e, f1.rutas), km: km(f1.rutas) };
    for (const presupuesto of [0, 1, 3, 7, 20]) {
      const r = reacomodar(e, f1.rutas, porId, undefined, presupuesto);
      expect(r.evaluaciones).toBeLessThanOrEqual(presupuesto);
      expect(reacomodar(e, f1.rutas, porId, undefined, presupuesto)).toEqual(r);
      expect(tiempoMuerto(e, r.rutas)).toBeLessThanOrEqual(inicial.tm);
      expect(atendidas(r.rutas)).toEqual(atendidas(f1.rutas));
      if (presupuesto === 0) expect(r).toEqual({ rutas: f1.rutas, movimientos: 0, evaluaciones: 0 });
    }
  });
});

describe("presupuesto y orden canónico (revisión de Codex)", () => {
  /** Solicitudes en puntos distintos y una ruta inicial por unidad, sin pasar por la admisión. */
  function inicial(ids: string[], viajesPorUnidad: Record<string, string[][]>, minutos: (a: string, b: string) => number,
    descargaMin = 0, tiempoServicioMin = 20, toleranciaReadmisionMin = 15) {
    const puntos = [patio, ...ids.map((_, i) => ({ lat: 20.7 + i / 1000, lng: -100.2 }))];
    const nombres = ["P", ...ids];
    const e = conMatriz(entrada(ids.map((id, i) => solicitud(id, { ubicacion: puntos[i + 1], registradaEn: registro(i % 10), cargaKg: 100, tiempoServicioMin })),
      Object.keys(viajesPorUnidad).map(u => unidad(u))), puntos, (i, j) => minutos(nombres[i], nombres[j]));
    e.parametros.descargaMin = descargaMin;
    e.parametros.toleranciaReadmisionMin = toleranciaReadmisionMin;
    const rutas = Object.entries(viajesPorUnidad).map(([u, viajes]) => {
      const r = recalcularRuta(e, u, viajes);
      if (!r.ok) throw new Error("ruta inicial");
      return r.ruta;
    });
    return { e, rutas, porId: new Map(e.solicitudes.map(x => [x.id, x])) };
  }

  it("el corte del presupuesto aplica la mejor mejora encontrada hasta ahí, y evaluaciones son las llamadas reales al cálculo", () => {
    // P–A y P–B: 30 en ambos sentidos; A→B 200 y B→A 150; sin descarga. Inicial: [A, B] = 30 + 200 + 30 = 260.
    // Mover A, en orden canónico: [B, A] = 210 (evaluación 1) y [B] | [A] = 120 (evaluación 2).
    // Mover B: [B, A] ya está en la caché (no cuesta) y [A] | [B] = 120 (evaluación 3) empata y no reemplaza.
    const { e, rutas, porId } = inicial(["A", "B"], { u1: [["A", "B"]] },
      (a, b) => (a === "P" || b === "P" ? 30 : a === "A" ? 200 : 150));
    const espia = vi.mocked(calculo.calcular);
    for (const [presupuesto, esperadas] of [[1, [["B", "A"]]], [2, [["B"], ["A"]]]] as const) {
      espia.mockClear();
      const r = reacomodar(e, rutas, porId, undefined, presupuesto);
      expect(secuencias(r.rutas[0])).toEqual(esperadas);
      expect(r.movimientos).toBe(1);
      expect(r.evaluaciones).toBe(presupuesto);
      expect(espia.mock.calls.length).toBe(r.evaluaciones);
    }
    espia.mockClear();
    const completo = reacomodar(e, rutas, porId, undefined, 1000);
    expect(espia.mock.calls.length).toBe(completo.evaluaciones);
    expect(tiempoMuerto(e, completo.rutas)).toBe(120);
  });

  it("entre cadenas que empatan gana la primera por unidad, viaje y posición, aunque sea más larga", () => {
    // Todos a 5 min entre sí y a 30 del patio; descarga 15. u1 = [X1, X2, X3], u2 = [Z1, Z2], u3 = [W1, W2].
    // Ningún viaje tiene una sola parada: mover una sola quita 5 en su viaje y agrega 5 en otro (0), e intercambiar
    // tampoco cambia nada. Mover la cadena de 3 de u1 a u2 vacía u1: −(65 + 5 + 15) + 15 = −70; mover la de 2 de u2
    // vacía u2: −(60 + 5 + 15) + 10 = −70. Con el presupuesto justo para la primera mejora, se ve cuál se tomó.
    // Servicios de 5 min y tolerancia 60: la unidad que recibe la cadena termina 30 (u2) o 20 (u1) min después,
    // dentro del límite de la fase.
    const { e, rutas, porId } = inicial(["X1", "X2", "X3", "Z1", "Z2", "W1", "W2"],
      { u1: [["X1", "X2", "X3"]], u2: [["Z1", "Z2"]], u3: [["W1", "W2"]] }, (a, b) => (a === "P" || b === "P" ? 30 : 5), 15, 5, 60);
    let r = reacomodar(e, rutas, porId, undefined, 0);
    for (let presupuesto = 1; r.movimientos === 0 && presupuesto < 3000; presupuesto++) r = reacomodar(e, rutas, porId, undefined, presupuesto);
    expect(r.movimientos).toBe(1);
    expect(tiempoMuerto(e, r.rutas)).toBe(tiempoMuerto(e, rutas) - 70);
    expect(secuencias(r.rutas.find(x => x.unidadId === "u1")!)).toEqual([]);
    expect(atendidas([r.rutas.find(x => x.unidadId === "u2")!])).toEqual(["X1", "X2", "X3", "Z1", "Z2"]);
  });
});

describe("límite de fin por unidad (decisión del usuario, 2026-10-29)", () => {
  it("un reacomodo no hace terminar a una unidad más de la tolerancia después", () => {
    // A y B a 5 min entre sí y a 30 del patio; servicios de 5 y descarga 15. u1 = [A] y u2 = [B], cada una termina a
    // las 560. Juntar las dos en una unidad ahorra 55 de tiempo muerto, y esa unidad termina a las 570 (+10).
    const lugar = (i: number) => ({ lat: 20.7 + i / 1000, lng: -100.2 });
    const armar = (tolerancia: number) => {
      const e = conMatriz(entrada([solicitud("A", { ubicacion: lugar(0), tiempoServicioMin: 5, registradaEn: registro(0) }),
        solicitud("B", { ubicacion: lugar(1), tiempoServicioMin: 5, registradaEn: registro(1) })], [unidad("u1"), unidad("u2")]),
        [patio, lugar(0), lugar(1)], (i, j) => (i === 0 || j === 0 ? 30 : 5));
      e.parametros.toleranciaReadmisionMin = tolerancia;
      const rutas = [["u1", "A"], ["u2", "B"]].map(([u, id]) => { const r = recalcularRuta(e, u, [[id]]); if (!r.ok) throw new Error("ruta"); return r.ruta; });
      return { e, rutas, porId: new Map(e.solicitudes.map(x => [x.id, x])) };
    };
    const con15 = armar(15);
    const junto = reacomodar(con15.e, con15.rutas, con15.porId, undefined, 1000);
    expect(junto.movimientos).toBe(1);
    expect(junto.rutas.map(r => r.viajes.at(-1)?.finDescargaMin ?? null)).toEqual(expect.arrayContaining([570, null]));
    const con5 = armar(5);
    const separado = reacomodar(con5.e, con5.rutas, con5.porId, undefined, 1000);
    expect(separado.movimientos).toBe(0);
    expect(separado.rutas).toEqual(con5.rutas);
  });

  it("el caso que dio pie a la decisión: con horas pico, dos viajes repartidos no se juntan en una unidad", () => {
    // Dos unidades de 1700 kg y cuatro clientes de 800 kg en línea; horas pico de la configuración por omisión.
    // Juntar los dos viajes en una unidad ahorraría 9 min de tiempo muerto pero la haría terminar 97 min después.
    const e = entrada([1, 2, 3, 4].map(i => solicitud(`s${i}`, { registradaEn: registro(i), cargaKg: 800,
      ubicacion: { lat: patio.lat + 0.01 * i, lng: patio.lng + 0.01 * i }, ventanas: [{ inicioMin: 480, finMin: 840 }] })),
      [unidad("u-a", { capacidadKg: 1700 }), unidad("u-b", { capacidadKg: 1700 })]);
    e.instanteMin = 420;
    e.parametros.horasPico = [{ inicioMin: 420, finMin: 570, factor: 1.3 }, { inicioMin: 810, finMin: 900, factor: 1.15 }];
    const plan = generarPlan(e);
    expect(validarPlan(e, plan)).toEqual([]);
    expect(plan.rutas.every(r => r.viajes.length === 1)).toBe(true);
    const f1 = admitir(e);
    for (const [k, r] of plan.rutas.entries()) expect(r.viajes.at(-1)!.finDescargaMin).toBeLessThanOrEqual(f1.rutas[k].viajes.at(-1)!.finDescargaMin + 15);
  });

  it("la validación rechaza un reacomodo que alarga una unidad más de la tolerancia", () => {
    // El escenario de horas pico, con un S2 manipulado que junta los dos viajes en u-a (ahorra 9 min, termina 97 después).
    const e = entrada([1, 2, 3, 4].map(i => solicitud(`s${i}`, { registradaEn: registro(i), cargaKg: 800,
      ubicacion: { lat: patio.lat + 0.01 * i, lng: patio.lng + 0.01 * i }, ventanas: [{ inicioMin: 480, finMin: 840 }] })),
      [unidad("u-a", { capacidadKg: 1700 }), unidad("u-b", { capacidadKg: 1700 })]);
    e.instanteMin = 420;
    e.parametros.horasPico = [{ inicioMin: 420, finMin: 570, factor: 1.3 }, { inicioMin: 810, finMin: 900, factor: 1.15 }];
    const plan = generarPlan(e);
    const viajes = plan.rutas.flatMap(r => r.viajes.map(v => v.paradas.map(p => p.solicitudId)));
    const ruta = (u: string, v: string[][]) => { const r = recalcularRuta(e, u, v); if (!r.ok) throw new Error("ruta"); return r.ruta; };
    const manipulado: Plan = JSON.parse(JSON.stringify(plan));
    manipulado.reacomodo!.rutasReacomodadas = [ruta("u-a", viajes), ruta("u-b", [])];
    expect(tiempoMuerto(e, manipulado.reacomodo!.rutasReacomodadas)).toBeLessThan(tiempoMuerto(e, plan.rutas));
    expect(validarPlan(e, manipulado)).toContain("Reacomodo: u-a termina más de la tolerancia después");
  });
});

describe("validación del 1.2.0 (§4.6, pasos 2, 4 y 5) y versiones", () => {
  const { s, puntos, minutos } = cuatroEsquinas();
  const e = conMatriz(entrada(s, [unidad("u1", { capacidadKg: 1600 })]), puntos, minutos);
  const plan = generarPlan(e);
  const ruta = (viajes: string[][]) => { const r = recalcularRuta(e, "u1", viajes); if (!r.ok) throw new Error("ruta"); return r.ruta; };

  it("rechaza un S2 que saca a una admitida o que empeora el objetivo", () => {
    const sinUna: Plan = structuredClone(plan);
    sinUna.reacomodo!.rutasReacomodadas = [ruta([["A", "C"], ["B"]])];
    expect(validarPlan(e, sinUna).join(" ")).toContain("Reacomodo: cambió las solicitudes atendidas");
    const peor: Plan = structuredClone(plan);
    peor.reacomodo!.rutasReacomodadas = [ruta([["A", "B"], ["C"], ["D"]])];   // 3 viajes: 285 > 270
    expect(validarPlan(e, peor).join(" ")).toContain("Reacomodo: empeoró");
  });

  it("rechaza un S4 peor que S3 aunque su resumen sea coherente, y un despues alterado", () => {
    const peor: Plan = structuredClone(plan);
    peor.rutas = [ruta([["A", "B"], ["C", "D"]])];
    const otro = generarPlan(e);
    // Resumen coherente con las rutas manipuladas: lo calcula el ajuste manual sin reacomodar.
    peor.resumen = { ...otro.reacomodo!.antes };
    peor.reacomodo!.despues = { ...otro.reacomodo!.antes };
    expect(validarPlan(e, peor).join(" ")).toContain("Reacomodo final: empeoró");
    const despues: Plan = structuredClone(plan);
    despues.reacomodo!.despues.tiempoMuertoMin = 150;
    expect(validarPlan(e, despues)).toContain("reacomodo.despues no coincide con el resumen del plan");
  });

  it("campos por versión: un 1.1.0 con reacomodo o tiempo muerto y un 1.2.0 sin ellos se rechazan", () => {
    const f1 = admitir(e);
    expect(validarPlan(e, { ...f1, reacomodo: plan.reacomodo })).toContain("Reacomodo y tiempo muerto solo existen en la versión 1.2.0");
    expect(validarPlan(e, { ...f1, resumen: { ...f1.resumen, tiempoMuertoMin: 270 } })).toContain("Reacomodo y tiempo muerto solo existen en la versión 1.2.0");
    const { reacomodo: _sin, ...sinReacomodo } = plan;
    void _sin;
    expect(validarPlan(e, sinReacomodo)).toContain("La versión 1.2.0 exige reacomodo y tiempo muerto");
    expect(validarPlan(e, { ...plan, reacomodo: { ...plan.reacomodo!, antes: { ...plan.reacomodo!.antes, tiempoMuertoMin: 1 } } }))
      .toContain("reacomodo.antes no coincide con la admisión");
    expect(validarPlan({ ...e, parametros: { ...e.parametros, toleranciaReadmisionMin: 61 } }, plan)).toContain("Tolerancia de readmisión inválida");
  });
});

describe("propiedades del reacomodo", () => {
  const objetivo = (e: EntradaPlan, rutas: RutaPlan[]) => [tiempoMuerto(e, rutas), km(rutas)] as const;
  const noEmpeora = ([tm, k]: readonly [number, number], [tm0, k0]: readonly [number, number]) => tm < tm0 || (tm === tm0 && k <= k0 + 1e-6);

  it("generadores del Plan 3: S1 ⊆ S4, objetivo por fase, determinismo, partición, tipo y sin viajes vacíos", () => {
    fc.assert(fc.property(casos, e => {
      const plan = generarPlan(e), f1 = admitir(e);
      const r = plan.reacomodo!;
      expect(generarPlan(e)).toEqual(plan);
      expect(validarPlan(e, plan)).toEqual([]);
      expect(plan.traza).toEqual(f1.traza);
      // S1 ⊆ S4: la readmisión puede agregar, nunca quitar.
      const finales = new Set(atendidas(plan.rutas));
      expect(atendidas(f1.rutas).every(id => finales.has(id))).toBe(true);
      expect(atendidas(r.rutasReacomodadas)).toEqual(atendidas(f1.rutas));
      expect(noEmpeora(objetivo(e, r.rutasReacomodadas), objetivo(e, f1.rutas))).toBe(true);
      expect(noEmpeora(objetivo(e, plan.rutas), objetivo(e, r.rutasReacomodadas))).toBe(true);
      const unidades = new Map(e.unidades.map(u => [u.id, u]));
      const porId = new Map(e.solicitudes.map(x => [x.id, x]));
      for (const rutas of [plan.rutas, r.rutasReacomodadas]) for (const ruta of rutas) {
        const u = unidades.get(ruta.unidadId)!;
        for (const [k, v] of ruta.viajes.entries()) {
          if (!v.paradas.length) expect(k === 0 && u.cargaActualKg > 0).toBe(true);
          for (const p of v.paradas) expect(porId.get(p.solicitudId)!.tiposUnidadAdmitidos).toContain(u.tipo);
        }
      }
    }), { seed: 20261022, numRuns: 100 });
  });

  it("matrices híbridas y horas pico con una protegida: queda en su unidad y viaje, y el plan valida", () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 60 }), { minLength: 36, maxLength: 36 }), valores => {
      const e = entrada(Array.from({ length: 5 }, (_, i) => solicitud(`s${i}`, {
        ubicacion: { lat: patio.lat + (i + 1) / 1000, lng: patio.lng }, cargaKg: 3000, registradaEn: registro(i),
        ventanas: [{ inicioMin: 480, finMin: 600 }, { inicioMin: 630, finMin: 850 }],
      })), [unidad("u1"), unidad("u2")]);
      const puntos = [patio, ...e.solicitudes.map(x => x.ubicacion)];
      conMatriz(e, puntos, (i, j) => valores[i * 6 + j]);
      e.parametros.horasPico = [{ inicioMin: 480, finMin: 570, factor: 1.3 }, { inicioMin: 810, finMin: 900, factor: 1.15 }];
      const restricciones = { admitidas: { u1: [["s0"]] } };
      const plan = generarPlan(e, restricciones);
      expect(validarPlan(e, plan, { restricciones })).toEqual([]);
      expect(generarPlan(e, restricciones)).toEqual(plan);
      for (const rutas of [plan.rutas, plan.reacomodo!.rutasReacomodadas])
        expect(rutas.find(r => r.unidadId === "u1")!.viajes[0].paradas.map(p => p.solicitudId)).toContain("s0");
    }), { seed: 82, numRuns: 50 });
  });
});

describe("rendimiento (§3): generarPlan con validación en menos de 2000 ms", () => {
  function matrizDeFormula(e: EntradaPlan) {
    const puntos = [...new Map([e.parametros.patio, ...e.solicitudes.map(s => s.ubicacion), ...e.unidades.map(u => u.ubicacionInicial)]
      .map(p => [`${p.lat}|${p.lng}`, p])).values()];
    // Distancia rectilínea × 1.3 en km, a 30 km/h.
    const dist = (a: Coordenada, b: Coordenada) => (Math.abs(a.lat - b.lat) + Math.abs(a.lng - b.lng)) * 111 * 1.3;
    const kmM = puntos.map(a => puntos.map(b => dist(a, b)));
    e.traslados = { puntos, km: kmM, minLibres: kmM.map(f => f.map(k => k * 2)), ajusteM: puntos.map(() => 0), aproximados: [], mapa: "fórmula" };
    e.parametros.horasPico = [{ inicioMin: 420, finMin: 570, factor: 1.3 }, { inicioMin: 810, finMin: 900, factor: 1.15 }];
    return e;
  }
  const medir = (e: EntradaPlan) => { const inicio = performance.now(); const plan = generarPlan(e); return { plan, ms: performance.now() - inicio }; };

  it("60 solicitudes y 15 unidades con matriz y dos franjas", () => {
    const e = matrizDeFormula(entrada(Array.from({ length: 60 }, (_, i) => solicitud(`s${String(i).padStart(2, "0")}`, {
      ubicacion: { lat: patio.lat + (i % 10) / 1000, lng: patio.lng + Math.floor(i / 10) / 1000 }, registradaEn: `2026-10-14T07:${String(i).padStart(2, "0")}:00-06:00`,
    })), Array.from({ length: 15 }, (_, i) => unidad(`u${String(i).padStart(2, "0")}`))));
    const { plan, ms } = medir(e);
    expect(plan.resumen.ruteadas).toBe(60);
    expect(ms).toBeLessThan(2000);
  });

  it("rutas de varios viajes y clientes concentrados", () => {
    const e = matrizDeFormula(entrada(Array.from({ length: 60 }, (_, i) => solicitud(`s${String(i).padStart(2, "0")}`, {
      ubicacion: { lat: patio.lat + 0.02 + (i % 4) / 2000, lng: patio.lng + Math.floor(i / 20) / 2000 }, cargaKg: 900, tiempoServicioMin: 10,
      registradaEn: `2026-10-14T07:${String(i).padStart(2, "0")}:00-06:00`,
    })), Array.from({ length: 6 }, (_, i) => unidad(`u${i}`, { capacidadKg: 2000 }))));
    const { plan, ms } = medir(e);
    expect(plan.rutas.some(r => r.viajes.length > 1)).toBe(true);
    expect(ms).toBeLessThan(2000);
  });
});
