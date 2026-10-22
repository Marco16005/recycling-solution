import { describe, expect, it } from "vitest";
import { solicitudSchema } from "./esquemas";
import { CANALES_CAPTURA, type SolicitudEntrada } from "./tipos";

const entrada: SolicitudEntrada = {
  clienteId: "00000000-0000-4000-8000-000000000001", fechaSolicitada: "2028-02-29", canal: "telefono",
  cargaEstimadaKg: null, notas: null, capturaInicioEn: new Date("2026-10-14T15:00:00Z"),
};

describe("solicitudSchema", () => {
  it.each(CANALES_CAPTURA)("acepta canal %s y fecha bisiesta real", (canal) => expect(solicitudSchema.safeParse({ ...entrada, canal }).success).toBe(true));
  // Plan CRM: "propuesta" solo lo pone la confirmación de una propuesta, no la captura a mano.
  it("rechaza el canal propuesta en la captura a mano", () => expect(solicitudSchema.safeParse({ ...entrada, canal: "propuesta" }).success).toBe(false));
  it.each([null, 1, 60000])("acepta carga %s", (cargaEstimadaKg) => expect(solicitudSchema.safeParse({ ...entrada, cargaEstimadaKg, capturaInicioEn: null }).success).toBe(true));
  it("recorta notas y admite el límite de 500", () => {
    expect(solicitudSchema.parse({ ...entrada, notas: " nota " }).notas).toBe("nota");
    expect(solicitudSchema.safeParse({ ...entrada, notas: "x".repeat(500) }).success).toBe(true);
  });
  it.each([
    { clienteId: "no-uuid" }, { fechaSolicitada: "2026-02-29" }, { fechaSolicitada: "2026-04-31" },
    { fechaSolicitada: "2026-13-01" }, { fechaSolicitada: "14/10/2026" }, { canal: "fax" },
    { cargaEstimadaKg: 0 }, { cargaEstimadaKg: -1 }, { cargaEstimadaKg: 60001 }, { cargaEstimadaKg: "1000" },
    { cargaEstimadaKg: Infinity }, { notas: "x".repeat(501) }, { capturaInicioEn: "2026-10-14T15:00:00Z" },
    { capturaInicioEn: new Date("inválida") },
  ])("rechaza entrada inválida %j", (cambio) => expect(solicitudSchema.safeParse({ ...entrada, ...cambio }).success).toBe(false));
  it("rechaza entrada vacía, nula y campos omitidos", () => {
    for (const valor of [null, {}, { ...entrada, clienteId: undefined }, { ...entrada, capturaInicioEn: undefined }]) {
      expect(solicitudSchema.safeParse(valor).success).toBe(false);
    }
  });
});
