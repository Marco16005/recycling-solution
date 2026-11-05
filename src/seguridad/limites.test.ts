import { afterEach, describe, expect, it } from "vitest";
import { dentroDelLimite, LimitadorDeFrecuencia, LIMITES } from "./limites";

describe("límite de frecuencia (Plan de seguridad, hallazgo 5)", () => {
  const limite = { maximo: 3, ventanaMs: 60_000 };

  it("permite hasta el máximo dentro de la ventana y rechaza el siguiente", () => {
    const l = new LimitadorDeFrecuencia();
    expect([0, 1000, 2000, 3000].map((t) => l.intentar("u", limite, t))).toEqual([true, true, true, false]);
  });

  it("vuelve a permitir cuando sale de la ventana la marca más vieja", () => {
    const l = new LimitadorDeFrecuencia();
    for (const t of [0, 1000, 2000]) l.intentar("u", limite, t);
    expect(l.intentar("u", limite, 59_999)).toBe(false);
    expect(l.intentar("u", limite, 60_001)).toBe(true);
  });

  it("un rechazo no cuenta como intento", () => {
    const l = new LimitadorDeFrecuencia();
    for (const t of [0, 1, 2]) l.intentar("u", limite, t);
    for (let t = 3; t < 100; t++) expect(l.intentar("u", limite, t)).toBe(false);
    expect(l.intentar("u", limite, 60_001)).toBe(true);
  });

  it("cada usuario lleva su cuenta", () => {
    const l = new LimitadorDeFrecuencia();
    for (const t of [0, 1, 2]) l.intentar("a", limite, t);
    expect(l.intentar("a", limite, 3)).toBe(false);
    expect(l.intentar("b", limite, 3)).toBe(true);
  });

  describe("dentroDelLimite", () => {
    const anterior = process.env.LIMITAR_ACCIONES;
    afterEach(() => {
      if (anterior === undefined) delete process.env.LIMITAR_ACCIONES;
      else process.env.LIMITAR_ACCIONES = anterior;
    });

    it("aplica el límite del motor por usuario", () => {
      process.env.LIMITAR_ACCIONES = "si";
      const ahora = new Date("2026-11-05T15:00:00Z");
      const permitidos = Array.from({ length: LIMITES.motor.maximo + 1 }, () => dentroDelLimite("motor", "usuario-limite", ahora));
      expect(permitidos.filter(Boolean)).toHaveLength(LIMITES.motor.maximo);
      expect(permitidos.at(-1)).toBe(false);
    });

    it("con LIMITAR_ACCIONES=no no limita", () => {
      process.env.LIMITAR_ACCIONES = "no";
      const ahora = new Date("2026-11-05T15:00:00Z");
      for (let i = 0; i < 50; i++) expect(dentroDelLimite("motor", "usuario-sin-limite", ahora)).toBe(true);
    });
  });
});
