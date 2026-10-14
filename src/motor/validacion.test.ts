import { describe, expect, it } from "vitest";
import { generarPlan, validarPlan } from "./index";
import { entrada, solicitud, unidad } from "./ejemplos.test-datos";
import type { Plan } from "./tipos";

describe("Validador independiente ante planes manipulados", () => {
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
