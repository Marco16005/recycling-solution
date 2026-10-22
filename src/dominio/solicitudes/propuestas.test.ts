import { describe, expect, it } from "vitest";
import { propuestasParaFecha, ritmoAprendido, tocaRecurrencia, type CandidatoPropuesta } from "./propuestas";

const LUN_SAB = [1, 2, 3, 4, 5, 6];
const base = (cambios: Partial<CandidatoPropuesta> = {}): CandidatoPropuesta => ({
  clienteId: "c1", activo: true, habilitadoEnFecha: true, tieneSolicitudAbierta: false,
  recurrencia: null, ritmo: null, decisiones: [], ...cambios,
});

describe("ritmoAprendido (Plan CRM, §4.4)", () => {
  it("mediana de 7, 8 y 6 días", () =>
    expect(ritmoAprendido(["2026-09-01", "2026-09-08", "2026-09-16", "2026-09-22"], "2026-10-01")).toEqual({ dias: 7, ultima: "2026-09-22", muestra: 4 }));
  it("con dos fechas no hay ritmo", () => expect(ritmoAprendido(["2026-09-01", "2026-09-08"], "2026-10-01")).toBeNull());
  it("las de más de 180 días no cuentan, y el orden de entrada no importa", () => {
    expect(ritmoAprendido(["2026-01-01", "2026-09-08", "2026-09-01"], "2026-10-01")).toBeNull();
    expect(ritmoAprendido(["2026-09-22", "2026-09-01", "2026-09-16", "2026-09-08"], "2026-10-01")?.dias).toBe(7);
  });
  it("con mediana par toma el promedio redondeado", () =>
    expect(ritmoAprendido(["2026-09-01", "2026-09-05", "2026-09-15", "2026-09-20", "2026-10-01"], "2026-10-02")?.dias).toBe(8));
});

describe("tocaRecurrencia", () => {
  it("días de la semana", () => {
    expect(tocaRecurrencia({ tipo: "dias_semana", dias: [2, 5] }, "2026-10-20")).toBe(true);   // martes
    expect(tocaRecurrencia({ tipo: "dias_semana", dias: [2, 5] }, "2026-10-21")).toBe(false);  // miércoles
  });
  it("cada N días desde una fecha", () => {
    const r = { tipo: "cada_n_dias" as const, cadaDias: 10, desde: "2026-10-01" };
    expect(["2026-10-01", "2026-10-11", "2026-10-21"].map((f) => tocaRecurrencia(r, f))).toEqual([true, true, true]);
    expect(["2026-09-21", "2026-10-12"].map((f) => tocaRecurrencia(r, f))).toEqual([false, false]);
  });
});

describe("propuestasParaFecha", () => {
  const ritmo = { dias: 7, ultima: "2026-10-15", muestra: 4 };   // esperada: 2026-10-22
  it("entra con la fecha esperada entre D − 3 y D, no con D − 4 ni antes de la esperada", () => {
    expect(propuestasParaFecha("2026-10-22", LUN_SAB, [base({ ritmo })])).toEqual([{ clienteId: "c1", motivos: ["ritmo"], fechaEsperada: "2026-10-22", ritmo }]);
    expect(propuestasParaFecha("2026-10-24", LUN_SAB, [base({ ritmo })])).toHaveLength(1);
    expect(propuestasParaFecha("2026-10-26", LUN_SAB, [base({ ritmo })])).toEqual([]);
    expect(propuestasParaFecha("2026-10-21", LUN_SAB, [base({ ritmo })])).toEqual([]);
  });
  it("una sola propuesta con dos motivos", () =>
    expect(propuestasParaFecha("2026-10-22", LUN_SAB, [base({ ritmo, recurrencia: { tipo: "dias_semana", dias: [4] } })])[0].motivos).toEqual(["recurrencia", "ritmo"]));
  it.each([
    ["solicitud abierta", { tieneSolicitudAbierta: true }],
    ["inactivo", { activo: false }],
    ["no habilitado", { habilitadoEnFecha: false }],
    ["decisión del mismo día", { decisiones: [{ fecha: "2026-10-22", estado: "descartada" as const, pospuestaHasta: null }] }],
    ["pospuesta vigente", { decisiones: [{ fecha: "2026-10-20", estado: "pospuesta" as const, pospuestaHasta: "2026-10-27" }] }],
  ])("no propone con %s", (_n, cambios) => expect(propuestasParaFecha("2026-10-22", LUN_SAB, [base({ ritmo, ...cambios })])).toEqual([]));
  it("un día que no es de operación no tiene propuestas", () =>
    expect(propuestasParaFecha("2026-10-25", LUN_SAB, [base({ recurrencia: { tipo: "dias_semana", dias: [0] } })])).toEqual([]));
  it("una posposición vencida es motivo propio, aunque ya no toque ritmo ni recurrencia, hasta que se decida", () => {
    const decisiones = [{ fecha: "2026-10-22", estado: "pospuesta" as const, pospuestaHasta: "2026-10-29" }];
    expect(propuestasParaFecha("2026-10-29", LUN_SAB, [base({ ritmo, decisiones })])).toEqual([{ clienteId: "c1", motivos: ["pospuesta"], fechaEsperada: "2026-10-29", ritmo }]);
    expect(propuestasParaFecha("2026-10-30", LUN_SAB, [base({ ritmo, decisiones })])[0]?.motivos).toEqual(["pospuesta"]);
    const confirmada = [...decisiones, { fecha: "2026-10-29", estado: "confirmada" as const, pospuestaHasta: null }];
    expect(propuestasParaFecha("2026-10-30", LUN_SAB, [base({ decisiones: confirmada })])).toEqual([]);
  });
});
