import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ajustarPlan, ErrorAdmitidas, generarPlan, validarPlan } from "./index";
import { entrada, solicitud, unidad } from "./ejemplos.test-datos";
import type { RestriccionesPlan } from "./tipos";

const restricciones: RestriccionesPlan = { admitidas: { u1: [["b", "a"], ["c"]] } };
const base = () => entrada(["a", "b", "c", "d"].map(id => solicitud(id, { cargaKg: 100, tiempoServicioMin: 5 })), [unidad(), unidad("u2")]);

describe("admitidas del re-ruteo", () => {
  it("admite antes de FIFO, preserva unidad, viaje y orden y permite inserciones", () => {
    const e = base(), plan = generarPlan(e, restricciones);
    expect(validarPlan(e, plan, { restricciones })).toEqual([]);
    expect(plan.traza.map(d => d.solicitudId)).toEqual(["d"]);
    const viajes = plan.rutas.find(r => r.unidadId === "u1")!.viajes;
    expect(viajes[0].paradas.filter(p => p.solicitudId !== "d").map(p => p.solicitudId)).toEqual(["b", "a"]);
    expect(viajes[1].paradas.filter(p => p.solicitudId !== "d").map(p => p.solicitudId)).toEqual(["c"]);
    expect(plan.resumen.ruteadas).toBe(4);
    expect(plan.rutas.flatMap(r => r.viajes).some(v => v.paradas.length > (v.numero === 1 ? 2 : 1))).toBe(true);
  });
  it("una admitida reciente tiene prioridad sobre la cola antigua", () => {
    const e = entrada([solicitud("antigua", { tiempoServicioMin: 450 }), solicitud("nueva", { tiempoServicioMin: 100 })]);
    const r = { admitidas: { u1: [["nueva"]] } };
    const plan = generarPlan(e, r);
    expect(plan.pospuestas.map(p => p.solicitudId)).toEqual(["antigua"]);
    expect(validarPlan(e, plan, { restricciones: r })).toEqual([]);
  });
  it("propiedad: restricciones sobreviven inserciones y se comprueban sin traza en ajuste manual", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 0, max: 12 }),
      fc.integer({ min: 1, max: 15 }), (cantidad, nuevas, servicio) => {
        const ids = Array.from({ length: cantidad }, (_, i) => `a${i}`);
        const cola = Array.from({ length: nuevas }, (_, i) => `n${i}`);
        const e = entrada([...ids, ...cola].map(id => solicitud(id, { cargaKg: 100, tiempoServicioMin: servicio })), [unidad(), unidad("u2")]);
        const r = { admitidas: { u1: [ids.slice().reverse(), ["otra"]] } };
        e.solicitudes.push(solicitud("otra", { cargaKg: 100, tiempoServicioMin: servicio }));
        const copia = structuredClone({ e, r });
        const plan = generarPlan(e, r);
        expect({ e, r }).toEqual(copia);
        expect(generarPlan(e, r)).toEqual(plan);
        expect(validarPlan(e, plan, { restricciones: r })).toEqual([]);
        expect(validarPlan(e, { ...plan, traza: [] }, { ajustadoAMano: true, restricciones: r })).toEqual([]);
        const viajes = plan.rutas.find(r => r.unidadId === "u1")!.viajes;
        expect(viajes[0].paradas.map(p => p.solicitudId).filter(id => ids.includes(id))).toEqual(r.admitidas.u1[0]);
        expect(viajes[1].paradas.some(p => p.solicitudId === "otra")).toBe(true);
        for (const id of [...ids, "otra"]) {
          for (const ajuste of [{ tipo: "posponer" as const, solicitudId: id },
            { tipo: "mover" as const, solicitudId: id, unidadId: "u2", viaje: 1, posicion: 1 }]) {
            expect(ajustarPlan(e, plan, ajuste, r)).toMatchObject({ ok: false, error: "entrada_invalida" });
          }
        }
        // Un plan factible generado sin las restricciones no puede usarse como prueba de cumplimiento.
        const alteradas = { admitidas: { u2: r.admitidas.u1 } };
        expect(validarPlan(e, plan, { ajustadoAMano: true, restricciones: alteradas }).length).toBeGreaterThan(0);
      }), { numRuns: 100 });
  });
  it.each(["retirada", "unidad", "viaje", "orden"])("detecta admitida alterada: %s, aun con traza coherente", cambio => {
    const e = base();
    const alternativas: Record<string, RestriccionesPlan> = {
      retirada: { admitidas: { u1: [["b"], ["c"]] } },
      unidad: { admitidas: { u2: [["b", "a"], ["c"]] } },
      viaje: { admitidas: { u1: [["c"], ["b", "a"]] } },
      orden: { admitidas: { u1: [["a", "b"], ["c"]] } },
    };
    if (cambio === "retirada") e.solicitudes = e.solicitudes.filter(s => s.id !== "a");
    const plan = generarPlan(e, alternativas[cambio]);
    for (const ajustadoAMano of [false, true])
      expect(validarPlan(base(), plan, { ajustadoAMano, restricciones }).length).toBeGreaterThan(0);
  });
  it.each(["unidad", "desconocida", "repetida", "vacía", "tipo", "capacidad", "ventana", "turno"])("ErrorAdmitidas: %s", causa => {
    const e = base(), r = structuredClone(restricciones);
    if (causa === "unidad") r.admitidas = { otra: [["a"]] };
    if (causa === "desconocida") r.admitidas.u1[0].push("desconocida");
    if (causa === "repetida") r.admitidas.u2 = [["a"]];
    if (causa === "vacía") r.admitidas.u1.push([]);
    if (causa === "tipo") e.solicitudes[0].tiposUnidadAdmitidos = ["rabon"];
    if (causa === "capacidad") e.unidades[0].capacidadKg = 150;
    if (causa === "ventana") e.solicitudes[0].ventanas = [{ inicioMin: 0, finMin: 1 }];
    if (causa === "turno") e.solicitudes[0].tiempoServicioMin = 1000;
    expect(() => generarPlan(e, r)).toThrow(ErrorAdmitidas);
  });
  it("propiedad: admitidas inviables nunca se posponen silenciosamente", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 7999 }), capacidad => {
      const e = entrada([solicitud("a", { cargaKg: capacidad + 1 })], [unidad("u1", { capacidadKg: capacidad })]);
      expect(() => generarPlan(e, { admitidas: { u1: [["a"]] } })).toThrow(ErrorAdmitidas);
    }));
  });
  it("ajusta las nuevas y actualiza hora manteniendo las restricciones", () => {
    const e = base(), plan = generarPlan(e, restricciones);
    for (const ajuste of [{ tipo: "posponer" as const, solicitudId: "d" },
      { tipo: "mover" as const, solicitudId: "d", unidadId: "u2", viaje: 1, posicion: 1 },
      { tipo: "actualizarHora" as const, instanteMin: 490 }]) {
      const resultado = ajustarPlan(e, plan, ajuste, restricciones);
      expect(resultado.ok).toBe(true);
      if (resultado.ok) expect(validarPlan(resultado.entrada, resultado.plan, { ajustadoAMano: true, restricciones })).toEqual([]);
    }
  });
  it("propiedad: FIFO entre las nuevas reserva primero el espacio de una admitida reciente", () => {
    fc.assert(fc.property(fc.integer({ min: 5, max: 20 }), fc.integer({ min: 1, max: 10 }), (cantidad, servicio) => {
      const ids = Array.from({ length: cantidad }, (_, i) => `s${String(i).padStart(2, "0")}`);
      const e = entrada([...ids, "z-admitida"].map(id => solicitud(id, { cargaKg: 100, tiempoServicioMin: servicio })));
      e.parametros.turnoFinMin = 480 + 15 + 5 * servicio;
      const r = { admitidas: { u1: [["z-admitida"]] } };
      const plan = generarPlan(e, r);
      const ruteadas = plan.rutas.flatMap(r => r.viajes.flatMap(v => v.paradas.map(p => p.solicitudId)));
      expect(ruteadas.sort()).toEqual([...ids.slice(0, 4), "z-admitida"].sort());
      expect(plan.pospuestas.map(p => p.solicitudId)).toEqual(ids.slice(4));
      expect(plan.traza.map(d => d.solicitudId)).toEqual(ids);
      const alterado = structuredClone(plan);
      [alterado.traza[0], alterado.traza[1]] = [alterado.traza[1], alterado.traza[0]];
      expect(validarPlan(e, alterado, { restricciones: r }).length).toBeGreaterThan(0);
    }));
  });
  it("restricciones vacías conservan el comportamiento anterior", () => {
    expect(generarPlan(base(), { admitidas: {} })).toEqual(generarPlan(base()));
  });
});
