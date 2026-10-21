import { expect, it } from "vitest";
import fc from "fast-check";
import { generarPlan as generarAnterior } from "./fixtures/admision-1.0.0.test-datos";
import historico from "./fixtures/plan-1.0.0.json";
import { ajustarPlan, distanciaKm, generarPlan, validarPlan } from "./index";
import { entrada, patio, solicitud, unidad } from "./ejemplos.test-datos";
import { casos } from "./casos.test-datos";
import type { EntradaPlan, MatrizTraslados, Plan } from "./tipos";

function matrizDeFormula(e: EntradaPlan): MatrizTraslados {
  const puntos = [...new Map([e.parametros.patio, ...e.solicitudes.map(s => s.ubicacion),
    ...e.unidades.map(u => u.ubicacionInicial)].map(p => [`${p.lat}|${p.lng}`, p])).values()];
  const km = puntos.map(a => puntos.map(b => distanciaKm(a, b, e.parametros.factorCircuidad)));
  return { puntos, km, minLibres: km.map(f => f.map(k => k * 60 / e.parametros.velocidadKmh)),
    ajusteM: puntos.map(() => 0), aproximados: [], mapa: "fórmula sintética" };
}
it("conserva la fixture anterior, calculada a mano, y su versión en ambos ajustes", () => {
  const e = historico.entrada as EntradaPlan, p = historico.plan as Plan;
  expect(validarPlan(e, p)).toEqual([]);
  expect(generarPlan(e)).toEqual({ ...p, versionMotor: "1.1.0" });
  for (const ajuste of [{ tipo: "mover" as const, solicitudId: "s1", unidadId: "u1", viaje: 1, posicion: 1 },
    { tipo: "actualizarHora" as const, instanteMin: 490 }]) {
    const r = ajustarPlan(e, p, ajuste);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plan.versionMotor).toBe("1.0.0");
      expect(validarPlan(r.entrada, r.plan, { ajustadoAMano: true })).toEqual([]);
    }
  }
  expect(validarPlan({ ...e, traslados: matrizDeFormula(e) }, p).length).toBeGreaterThan(0);
  expect(validarPlan({ ...e, parametros: { ...e.parametros, horasPico: [] } }, p).length).toBeGreaterThan(0);
});
it("la matriz de fórmula reproduce cada campo del modelo anterior en los generadores del Plan 3", () => {
  fc.assert(fc.property(casos, e => {
    const formula = generarAnterior(e);
    expect(validarPlan(e, { ...formula, versionMotor: "1.0.0" })).toEqual([]);
    expect(generarPlan({ ...e, traslados: matrizDeFormula(e) })).toEqual({ ...formula, versionMotor: "1.1.0" });
  }), { seed: 20261016, numRuns: 100 });
});
it("respeta dirección, minutos libres del resumen y detecta otra matriz", () => {
  const e = entrada([solicitud("a", { ubicacion: { lat: 21, lng: -100 } })]);
  e.traslados = { puntos: [patio, e.solicitudes[0].ubicacion], km: [[0, 2], [3, 0]],
    minLibres: [[0, 10], [20, 0]], ajusteM: [0, 0], aproximados: [[1, 0]], mapa: "s" };
  e.parametros.horasPico = [{ inicioMin: 480, finMin: 600, factor: 2 }];
  const p = generarPlan(e), v = p.rutas[0].viajes[0];
  expect(v.paradas[0].llegadaMin).toBe(500);
  expect(v.regresoPatioMin).toBe(560);
  expect(p.resumen).toMatchObject({ km: 5, kmMetodoActual: 5, minutosTraslado: 30, minutosTrasladoMetodoActual: 30 });
  const otra = structuredClone(e); otra.traslados!.minLibres[0][1] = 11;
  expect(validarPlan(otra, p).length).toBeGreaterThan(0);
});
it("matrices híbridas sin desigualdad triangular: determinismo, partición, FIFO y admitidas", () => {
  fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 60 }), { minLength: 25, maxLength: 25 }), valores => {
    const e = entrada(Array.from({ length: 4 }, (_, i) => solicitud(`s${i}`, {
      ubicacion: { lat: patio.lat + (i + 1) / 1000, lng: patio.lng }, cargaKg: 4000,
      ventanas: [{ inicioMin: 480, finMin: 600 }, { inicioMin: 630, finMin: 850 }],
    })));
    e.traslados = matrizDeFormula(e);
    e.traslados.minLibres = e.traslados.puntos.map((_, i) => e.traslados!.puntos.map((_, j) => i === j ? 0 : valores[i * 5 + j]));
    e.traslados.aproximados = [[0, 1]];
    e.parametros.horasPico = [{ inicioMin: 480, finMin: 570, factor: 1.3 }, { inicioMin: 810, finMin: 900, factor: 1.15 }];
    const restricciones = { admitidas: { u1: [["s0"]] } };
    const original = structuredClone(e);
    const p = generarPlan(e, restricciones);
    expect(generarPlan(e, restricciones)).toEqual(p);
    expect(validarPlan(e, p, { restricciones })).toEqual([]);
    expect(e).toEqual(original);
    expect(p.rutas[0].viajes[0].paradas.map(p => p.solicitudId)).toContain("s0");
    expect([...p.rutas.flatMap(r => r.viajes.flatMap(v => v.paradas)), ...p.pospuestas, ...p.bloqueadas]
      .map(p => p.solicitudId).sort()).toEqual(["s0", "s1", "s2", "s3"]);
  }), { seed: 71, numRuns: 50 });
});
it("60 solicitudes, 15 unidades, matriz y dos franjas en menos de 1000 ms", () => {
  const e = entrada(Array.from({ length: 60 }, (_, i) => solicitud(`s${String(i).padStart(2, "0")}`, {
    ubicacion: { lat: patio.lat + (i % 10) / 1000, lng: patio.lng + Math.floor(i / 10) / 1000 },
  })), Array.from({ length: 15 }, (_, i) => unidad(`u${i}`)));
  e.traslados = matrizDeFormula(e);
  e.parametros.horasPico = [{ inicioMin: 420, finMin: 570, factor: 1.3 }, { inicioMin: 810, finMin: 900, factor: 1.15 }];
  const inicio = performance.now();
  expect(generarPlan(e).resumen.ruteadas).toBe(60);
  expect(performance.now() - inicio).toBeLessThan(1000);
});
it("una inserción no triangular puede adelantar una admitida", () => {
  const e = entrada([solicitud("a", { ubicacion: { lat: 21, lng: -100 }, tiempoServicioMin: 5 }),
    solicitud("b", { ubicacion: { lat: 22, lng: -100 }, tiempoServicioMin: 5 })]);
  e.traslados = { puntos: [patio, e.solicitudes[0].ubicacion, e.solicitudes[1].ubicacion],
    km: [[0, 1, 10], [1, 0, 1], [1, 1, 0]], minLibres: [[0, 5, 60], [5, 0, 5], [5, 5, 0]],
    ajusteM: [0, 0, 0], aproximados: [[0, 2]], mapa: "híbrida sintética" };
  const r = { admitidas: { u1: [["b"]] } };
  const p = generarPlan(e, r);
  expect(p.rutas[0].viajes[0].paradas.map(p => [p.solicitudId, p.llegadaMin])).toEqual([["a", 485], ["b", 495]]);
  expect(validarPlan(e, p, { restricciones: r })).toEqual([]);
  const ajuste = ajustarPlan(e, p, { tipo: "actualizarHora", instanteMin: 490 }, r);
  expect(ajuste.ok).toBe(true);
  if (ajuste.ok) {
    expect(ajuste.plan.versionMotor).toBe("1.1.0");
    expect(ajuste.plan.rutas[0].viajes[0].paradas[0].llegadaMin).toBe(495);
  }
});
it("punto faltante se informa como entrada inválida al ajustar", () => {
  const e = entrada(), p = generarPlan(e);
  e.traslados = matrizDeFormula(e);
  e.solicitudes[0].ubicacion = { lat: 1, lng: 2 };
  expect(validarPlan(e, p)).toEqual(["Traslados: punto_faltante"]);
  expect(ajustarPlan(e, p, { tipo: "actualizarHora", instanteMin: 490 }))
    .toMatchObject({ ok: false, error: "entrada_invalida" });
});
it("FIFO con matriz y pico reserva el cupo a las antiguas", () => {
  fc.assert(fc.property(fc.integer({ min: 5, max: 12 }), cantidad => {
    const e = entrada(Array.from({ length: cantidad }, (_, i) => solicitud(`s${String(i).padStart(2, "0")}`, {
      tiempoServicioMin: 10, cargaKg: 100, ubicacion: { lat: 21, lng: -100 },
    })));
    e.traslados = { puntos: [patio, e.solicitudes[0].ubicacion], km: [[0, 1], [2, 0]],
      minLibres: [[0, 5], [10, 0]], ajusteM: [0, 0], aproximados: [[1, 0]], mapa: "sintético" };
    e.parametros.horasPico = [{ inicioMin: 480, finMin: 600, factor: 2 }];
    // 10 ida + 40 servicio + 20 regreso + 15 descarga = 85: caben exactamente cuatro.
    e.parametros.turnoFinMin = 565;
    const p = generarPlan(e);
    expect(p.pospuestas.map(p => p.solicitudId)).toEqual(e.solicitudes.slice(4).map(s => s.id));
    expect(p.resumen.ruteadas).toBe(4);
    expect(validarPlan(e, p)).toEqual([]);
  }));
});
