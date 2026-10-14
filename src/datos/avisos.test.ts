import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAMPOS_AVISO, llenarPlantilla } from "./avisos";

const plantilla = readFileSync("docs/legal/aviso-de-privacidad-integral.md", "utf8");
const completos = Object.fromEntries(CAMPOS_AVISO.map((c) => [c, `valor de ${c}`]));

describe("plantilla del aviso de privacidad", () => {
  it("con todos los datos no deja campos ni la nota de plantilla", () => {
    const texto = llenarPlantilla(plantilla, "2026-11-01", "2026-11-01", completos);
    expect(texto).not.toMatch(/\{\{/);
    expect(texto).not.toContain("Plantilla.");
    expect(texto).toContain("Versión 2026-11-01");
    expect(texto).toContain("valor de RAZON_SOCIAL");
  });

  it("se niega si falta un dato o la versión no tiene formato de fecha", () => {
    expect(() => llenarPlantilla(plantilla, "2026-11-01", "2026-11-01", { ...completos, CORREO_PRIVACIDAD: " " })).toThrow(/AVISO_CORREO_PRIVACIDAD/);
    expect(() => llenarPlantilla(plantilla, "v2", "2026-11-01", completos)).toThrow(/AAAA-MM-DD/);
  });

  it("detecta campos de la plantilla que el script no conoce", () => {
    expect(() => llenarPlantilla(`${plantilla}\n{{CAMPO_NUEVO}}`, "2026-11-01", "2026-11-01", completos)).toThrow(/CAMPO_NUEVO/);
  });
});
