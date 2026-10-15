import { describe, expect, it } from "vitest";
import { generarPlan, validarPlan } from "./index";
import { entrada, solicitud, unidad } from "./ejemplos.test-datos";
import type { Plan } from "./tipos";

describe("Validador independiente ante planes manipulados", () => {
  it("con opciones false conserva la validación automática", () => {
    const e = entrada();
    const p = generarPlan(e);
    expect(validarPlan(e, p, { ajustadoAMano: false })).toEqual([]);
    p.resumen.ruteadas++;
    expect(validarPlan(e, p, { ajustadoAMano: false })).toEqual(validarPlan(e, p));
  });
  it.each([undefined, { ajustadoAMano: false }])("rechaza pospuesta_a_mano en modo automático con %j", opciones => {
    const e = entrada([solicitud("s")], []);
    const p = generarPlan(e);
    p.pospuestas[0].motivo = "pospuesta_a_mano";
    expect(validarPlan(e, p, opciones)).toContain("Posposición manual en un plan automático");
  });
  it.each([false, true])("detecta posposición falsa con viaje existente=%s", existente => {
    const anteriores = existente ? [solicitud("a")] : [];
    const e = entrada([...anteriores, solicitud("b")]);
    const p = generarPlan(entrada(anteriores));
    const diagnostico = { capacidad: 1, ventana: 0, finDeTurno: 0, afectaAOtra: 0 };
    p.traza.push({ solicitudId: "b", resultado: "pospuesta", motivo: "sin_cupo", diagnostico, rutasAntes: structuredClone(p.rutas) });
    p.pospuestas.push({ solicitudId: "b", motivo: "sin_cupo", diagnostico });
    p.resumen.pospuestas++;
    expect(validarPlan(e, p)).toContain("FIFO: b fue pospuesta teniendo una inserción factible");
  });
  it("detecta una pospuesta que solo cabe en viaje nuevo", () => {
    const e = entrada([solicitud("a", { cargaKg: 8000 }), solicitud("b")]);
    const p = generarPlan({ ...e, solicitudes: [e.solicitudes[0]] });
    const diagnostico = { capacidad: 2, ventana: 0, finDeTurno: 0, afectaAOtra: 0 };
    p.traza.push({ solicitudId: "b", resultado: "pospuesta", motivo: "sin_cupo", diagnostico, rutasAntes: structuredClone(p.rutas) });
    p.pospuestas.push({ solicitudId: "b", motivo: "sin_cupo", diagnostico });
    p.resumen.pospuestas++;
    expect(validarPlan(e, p)).toContain("FIFO: b fue pospuesta teniendo una inserción factible");
  });
  it("detecta una admisión que rompe la ventana de un viaje posterior", () => {
    const e = entrada([
      solicitud("a", { cargaKg: 6000, tiempoServicioMin: 10 }),
      solicitud("b", { cargaKg: 6000, ventanas: [{ inicioMin: 505, finMin: 505 }] }),
      solicitud("c", { cargaKg: 2000 }),
    ]);
    const p = generarPlan(e);
    const ultima = p.traza.at(-1)!;
    if (ultima.resultado !== "admitida") throw new Error("El caso requiere una admisión al segundo viaje");
    ultima.viaje = 1;
    ultima.secuencia = 2;
    expect(validarPlan(e, p)).toContain("Admisión no factible: c");
  });
  it("detecta rutasAntes falsas aunque la salida final siga siendo factible", () => {
    const e = entrada([solicitud("a"), solicitud("b")]);
    const p = generarPlan(e);
    const segunda = p.traza[1];
    if (segunda.resultado === "bloqueada") throw new Error("Caso inesperado");
    segunda.rutasAntes = [];
    expect(validarPlan(e, p)).toContain("La traza altera rutas anteriores a b");
  });
  const alteraciones: [string, (p: Plan) => void][] = [
    ["capacidad", p => { p.rutas[0].viajes[0].cargaKg++; }],
    ["ventana inventada", p => { p.rutas[0].viajes[0].paradas[0].ventana.finMin++; }],
    ["espera negativa", p => { p.rutas[0].viajes[0].paradas[0].esperaMin = -1; }],
    ["servicio", p => { p.rutas[0].viajes[0].paradas[0].finServicioMin++; }],
    ["regreso", p => { p.rutas[0].viajes[0].regresoPatioMin++; }],
    ["descarga", p => { p.rutas[0].viajes[0].finDescargaMin++; }],
    ["salida", p => { p.rutas[0].viajes[0].salidaMin--; }],
    ["distancia", p => { p.rutas[0].viajes[0].km++; }],
    ["secuencia", p => { p.rutas[0].viajes[0].paradas[0].secuencia++; }],
    ["unidad desconocida", p => { p.rutas[0].unidadId = "otra"; }],
    ["duplicada", p => { p.rutas[0].viajes[0].paradas.push(p.rutas[0].viajes[0].paradas[0]); }],
    ["resumen", p => { p.resumen.minutosTrasladoMetodoActual++; }],
    ["no finito", p => { p.rutas[0].viajes[0].km = NaN; }],
  ];
  it.each(alteraciones)("rechaza %s", (_, alterar) => {
    const e = entrada();
    const p = structuredClone(generarPlan(e));
    alterar(p);
    expect(validarPlan(e, p).length).toBeGreaterThan(0);
  });
  it("no permite perder la descarga congelada ni falsear un bloqueo", () => {
    const e = entrada([], [unidad("u", { cargaActualKg: 500 })]);
    const p = generarPlan(e);
    p.rutas[0].viajes = [];
    expect(validarPlan(e, p).length).toBeGreaterThan(0);
    const otro = entrada([solicitud("s", { cargaKg: 9000 })]);
    const bloqueado = generarPlan(otro);
    otro.solicitudes[0].cargaKg = 1000;
    expect(validarPlan(otro, bloqueado)).toContain("Bloqueo injustificado: s");
  });
});

describe("Validador de ajustes manuales", () => {
  const manual = { ajustadoAMano: true };
  it("ignora longitud, orden y contenido de la traza, sin alterar el modo automático", () => {
    const e = entrada([solicitud("a"), solicitud("b")]);
    const p = generarPlan(e);
    p.traza.reverse();
    for (const d of p.traza) if (d.resultado !== "bloqueada") d.rutasAntes = [];
    p.traza.push(...structuredClone(p.traza));
    expect(validarPlan(e, p, manual)).toEqual([]);
    expect(validarPlan(e, p).length).toBeGreaterThan(0);
    p.traza = [];
    expect(validarPlan(e, p, manual)).toEqual([]);
  });
  const alteraciones: [string, (p: Plan) => void][] = [
    ["versión", p => { p.versionMotor = "otra"; }],
    ["carga", p => { p.rutas[0].viajes[0].cargaKg++; }],
    ["ventana", p => { p.rutas[0].viajes[0].paradas[0].ventana.finMin++; }],
    ["llegada", p => { p.rutas[0].viajes[0].paradas[0].llegadaMin++; }],
    ["inicio", p => { p.rutas[0].viajes[0].paradas[0].inicioServicioMin++; }],
    ["servicio", p => { p.rutas[0].viajes[0].paradas[0].finServicioMin++; }],
    ["espera", p => { p.rutas[0].viajes[0].paradas[0].esperaMin++; }],
    ["salida", p => { p.rutas[0].viajes[0].salidaMin++; }],
    ["regreso", p => { p.rutas[0].viajes[0].regresoPatioMin++; }],
    ["descarga", p => { p.rutas[0].viajes[0].finDescargaMin++; }],
    ["distancia", p => { p.rutas[0].viajes[0].paradas[0].kmDesdeAnterior++; }],
    ["km", p => { p.rutas[0].viajes[0].km++; }],
    ["secuencia", p => { p.rutas[0].viajes[0].paradas[0].secuencia = 2; }],
    ["viaje", p => { p.rutas[0].viajes[0].numero = 2; }],
    ["desconocida", p => { p.rutas[0].unidadId = "otra"; }],
    ["ruta repetida", p => { p.rutas.push(structuredClone(p.rutas[0])); }],
    ["partición", p => { p.pospuestas.push({ solicitudId: "s1", motivo: "pospuesta_a_mano", diagnostico: null }); }],
    ["solicitud desconocida", p => { p.rutas[0].viajes[0].paradas[0].solicitudId = "otra"; }],
    ["resumen", p => { p.resumen.kmMetodoActual++; }],
  ];
  it.each(alteraciones)("reconstruye y rechaza %s aunque no haya traza", (_, alterar) => {
    const e = entrada();
    const p = generarPlan(e);
    p.traza = [];
    alterar(p);
    expect(validarPlan(e, p, manual).length).toBeGreaterThan(0);
  });
  it("conserva unicidad, ISO, capacidad, tipo, ventanas y turno", () => {
    const original = entrada();
    const p = generarPlan(original);
    for (const alterar of [
      (e: typeof original) => { e.solicitudes.push(structuredClone(e.solicitudes[0])); },
      (e: typeof original) => { e.unidades.push(structuredClone(e.unidades[0])); },
      (e: typeof original) => { e.solicitudes[0].registradaEn = "sin fecha"; },
      (e: typeof original) => { e.solicitudes[0].registradaEn = "2026-02-30T07:00:00Z"; },
      (e: typeof original) => { e.solicitudes[0].registradaEn = "2026-10-15T25:00:00Z"; },
      (e: typeof original) => { e.fecha = "2026-02-30"; },
      (e: typeof original) => { e.unidades[0].capacidadKg = 1; },
      (e: typeof original) => { e.unidades[0].tipo = "camioneta"; },
      (e: typeof original) => { e.solicitudes[0].ventanas = [{ inicioMin: 0, finMin: 1 }]; },
      (e: typeof original) => { e.parametros.turnoFinMin = 481; },
    ]) {
      const e = structuredClone(original);
      alterar(e);
      expect(validarPlan(e, p, manual).length).toBeGreaterThan(0);
    }
  });
  it("exige ruta vacía por unidad y no pierde una descarga obligatoria", () => {
    const e = entrada([]);
    const p = generarPlan(e);
    p.rutas = [];
    expect(validarPlan(e, p, manual)).toContain("Falta la ruta de la unidad: u1");
    const cargada = entrada([], [unidad("u1", { cargaActualKg: 100 })]);
    const p2 = generarPlan(cargada);
    expect(validarPlan(cargada, p2, manual)).toEqual([]);
    p2.rutas[0].viajes = [];
    expect(validarPlan(cargada, p2, manual).length).toBeGreaterThan(0);
  });
  it("revalida motivos estructurales y exige diagnóstico null salvo sin_cupo", () => {
    const e = entrada([solicitud()], []);
    const p = generarPlan(e);
    expect(validarPlan(e, p, manual)).toEqual([]);
    p.pospuestas[0].motivo = "sin_unidad_compatible";
    expect(validarPlan(e, p, manual).length).toBeGreaterThan(0);
    p.pospuestas[0].motivo = "pospuesta_a_mano";
    expect(validarPlan(e, p, manual)).toEqual([]);
    p.pospuestas[0].diagnostico = { capacidad: 0, ventana: 0, finDeTurno: 0, afectaAOtra: 0 };
    expect(validarPlan(e, p, manual)).toContain("Diagnóstico debe ser null: s1");
    const compatible = entrada();
    const p2 = generarPlan(entrada([solicitud()], [unidad("u1", { tipo: "camioneta" })]));
    expect(validarPlan(compatible, p2, manual).length).toBeGreaterThan(0);
    p2.pospuestas[0].motivo = "sin_unidades_disponibles";
    expect(validarPlan(compatible, p2, manual).length).toBeGreaterThan(0);
  });
  it("sin_cupo conserva solo la forma del diagnóstico original, aunque ahora quepa", () => {
    const e = entrada([solicitud("s1", { ventanas: [{ inicioMin: 0, finMin: 1 }] })]);
    const p = generarPlan(e);
    e.solicitudes[0].ventanas = [{ inicioMin: 480, finMin: 960 }];
    expect(validarPlan(e, p, manual)).toEqual([]);
    expect(validarPlan(e, p).length).toBeGreaterThan(0);
    for (const diagnostico of [null, { capacidad: -1, ventana: 1, finDeTurno: 0, afectaAOtra: 0 },
      { capacidad: 0, ventana: 0, finDeTurno: 0, afectaAOtra: 1 },
      { capacidad: NaN, ventana: 1, finDeTurno: 0, afectaAOtra: 0 }]) {
      p.pospuestas[0].diagnostico = diagnostico;
      expect(validarPlan(e, p, manual).length).toBeGreaterThan(0);
    }
  });
  it("no permite ocultar una bloqueada como pospuesta ni inventar un bloqueo", () => {
    const e = entrada([solicitud("s1", { cargaKg: 9000 })]);
    const p = generarPlan(e);
    e.solicitudes[0].cargaKg = 1000;
    expect(validarPlan(e, p, manual)).toContain("Bloqueo injustificado: s1");
    e.solicitudes[0].cargaKg = 9000;
    p.bloqueadas = [];
    p.pospuestas = [{ solicitudId: "s1", motivo: "pospuesta_a_mano", diagnostico: null }];
    p.resumen.bloqueadas = 0; p.resumen.pospuestas = 1;
    expect(validarPlan(e, p, manual).length).toBeGreaterThan(0);
  });
});
