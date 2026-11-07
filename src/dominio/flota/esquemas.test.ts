import { describe, expect, it } from "vitest";
import { clienteSchema } from "../clientes/esquemas";
import { operadorSchema, unidadSchema } from "./esquemas";
import type { OperadorEntrada, UnidadEntrada } from "./tipos";

const documento = { tipoDocumentoId: "permiso", obligatorio: true, estado: "vigente" as const, venceEl: "2028-02-29", notas: null };
const unidad: UnidadEntrada = { placa: "ab-c 123", numeroEconomico: null, tipo: "rabon", capacidadKg: 1000, rendimientoKmL: 5, activo: true, notas: null, documentos: [documento] };
const operador: OperadorEntrada = { nombre: "Operador de prueba", telefono: null, activo: true, documentos: [documento] };

describe("unidadSchema", () => {
  it("normaliza placa y acepta límites", () => {
    expect(unidadSchema.parse(unidad).placa).toBe("ABC123");
    for (const capacidadKg of [1, 60000]) expect(unidadSchema.safeParse({ ...unidad, capacidadKg, rendimientoKmL: 50 }).success).toBe(true);
    expect(unidadSchema.safeParse({ ...unidad, rendimientoKmL: 0.1 }).success).toBe(true);
  });
  it.each(["torton", "trailer"] as const)("acepta la unidad %s", tipo => {
    expect(unidadSchema.parse({ ...unidad, tipo }).tipo).toBe(tipo);
  });
  it.each([
    { placa: " - " }, { placa: "ABC/123" }, { capacidadKg: 0 }, { capacidadKg: 60001 },
    { capacidadKg: "1000" }, { capacidadKg: NaN }, { rendimientoKmL: 0 }, { rendimientoKmL: -1 },
    { rendimientoKmL: 50.1 }, { rendimientoKmL: Infinity }, { tipo: "desconocido" }, { activo: "sí" }, { notas: "x".repeat(501) },
  ])("rechaza entrada inválida %j", (cambio) => expect(unidadSchema.safeParse({ ...unidad, ...cambio }).success).toBe(false));
});

describe("operadorSchema", () => {
  it.each([null, "+52 (442) 123-4567", "1234567890", "123456789012345", "123", "1234567890123456", "442123456a", ""])("comparte la regla de teléfono de clientes: %s", (telefono) => {
    expect(operadorSchema.safeParse({ ...operador, telefono }).success).toBe(clienteSchema.shape.contactoTelefono.safeParse(telefono).success);
  });
  it.each(["", " ", "x".repeat(121)])("rechaza nombre inválido", (nombre) => expect(operadorSchema.safeParse({ ...operador, nombre }).success).toBe(false));
  it("no recibe entrega del aviso como parte de la ficha", () => {
    expect(operadorSchema.parse({ ...operador, avisoVersion: "inventada" })).not.toHaveProperty("avisoVersion");
  });
});

for (const [nombre, esquema, entrada] of [["unidad", unidadSchema, unidad], ["operador", operadorSchema, operador]] as const) {
  describe(`documentos de ${nombre}`, () => {
    it("acepta fecha bisiesta real y ausencia de vencimiento", () => {
      expect(esquema.safeParse(entrada).success).toBe(true);
      expect(esquema.safeParse({ ...entrada, documentos: [{ ...documento, venceEl: null }] }).success).toBe(true);
    });
    it.each([{ venceEl: "2026-02-29" }, { venceEl: "2026-04-31" }, { venceEl: "14/10/2026" }, { tipoDocumentoId: " " }, { estado: "faltante" }, { obligatorio: null }, { notas: "x".repeat(501) }])("rechaza documento inválido %j", (cambio) => {
      expect(esquema.safeParse({ ...entrada, documentos: [{ ...documento, ...cambio }] }).success).toBe(false);
    });
    it("rechaza tipos repetidos después de recortar espacios e identifica el campo", () => {
      const resultado = esquema.safeParse({ ...entrada, documentos: [documento, { ...documento, tipoDocumentoId: " permiso " }] });
      expect(resultado.success).toBe(false);
      if (!resultado.success) expect(resultado.error.issues[0].path).toEqual(["documentos", 1, "tipoDocumentoId"]);
    });
    it("rechaza entrada nula e incompleta", () => {
      expect(esquema.safeParse(null).success).toBe(false);
      expect(esquema.safeParse({}).success).toBe(false);
    });
  });
}
