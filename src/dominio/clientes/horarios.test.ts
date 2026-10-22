import { describe, expect, it } from "vitest";
import { escribirHorarios, leerHorarios } from "./horarios";

describe("leerHorarios (Plan CRM, §4.1)", () => {
  it("lun-vie y sábado: 6 ventanas ordenadas", () => {
    const r = leerHorarios("lun-vie 08:00-14:00; sab 09:00-12:00");
    expect(r).toEqual({ ok: true, ventanas: [
      ...[1, 2, 3, 4, 5].map((diaSemana) => ({ diaSemana, horaInicio: "08:00", horaFin: "14:00" })),
      { diaSemana: 6, horaInicio: "09:00", horaFin: "12:00" },
    ] });
  });
  it("acepta acentos, mayúsculas, días sueltos, comas y dos franjas el mismo día", () => {
    const r = leerHorarios("LUN, MIÉ 08:00-10:00; Sáb 07:30-09:00; sáb 15:00-17:00; dom 10:00-11:00");
    expect(r.ok && r.ventanas.map((v) => `${v.diaSemana} ${v.horaInicio}-${v.horaFin}`)).toEqual([
      "0 10:00-11:00", "1 08:00-10:00", "3 08:00-10:00", "6 07:30-09:00", "6 15:00-17:00",
    ]);
  });
  it("vacío da sin ventanas", () => expect(leerHorarios("  ")).toEqual({ ok: true, ventanas: [] }));
  it.each([
    ["lunes a viernes 8-2"],
    ["lun-vie 14:00-08:00"],
    ["xyz 08:00-09:00"],
    ["lun 25:00-26:00"],
  ])("rechaza %s con un mensaje que dice cómo escribirlo", (texto) => {
    const r = leerHorarios(texto);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensaje).toContain("lun-vie 08:00-14:00");
  });
  it("ida y vuelta con escribirHorarios", () => {
    const r = leerHorarios("lun-vie 08:00-14:00; sab 09:00-12:00");
    if (!r.ok) throw new Error("debía leerse");
    expect(escribirHorarios(r.ventanas)).toBe("lun-vie 08:00-14:00; sab 09:00-12:00");
    expect(leerHorarios(escribirHorarios(r.ventanas))).toEqual(r);
    expect(escribirHorarios([])).toBe("");
  });
  it("un texto enorme o lleno de espacios se rechaza rápido (sin retroceso catastrófico)", () => {
    for (const texto of ["lun" + " ".repeat(50_000) + "x", "a ".repeat(20_000) + "08:00-09:00", ("lun 08:00-09:00;").repeat(100)]) {
      const inicio = performance.now();
      expect(leerHorarios(texto).ok).toBe(false);
      expect(performance.now() - inicio).toBeLessThan(50);
    }
  });
});
