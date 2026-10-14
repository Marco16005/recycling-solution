import { describe, expect, it } from "vitest";
import { documentosPorVencer, motivosNoDisponibleOperador, motivosNoDisponibleUnidad, normalizarPlaca } from "./disponibilidad";
import type { DocumentoRegistrado, Operador, TipoDocumento, Unidad } from "./tipos";

const fecha = "2026-10-14";
const tipo: TipoDocumento = { id: "permiso", nombre: "Permiso", aplicaA: "unidad", origen: "ley", obligatorioPorOmision: true, requiereVencimiento: true, descripcion: "Documento sintético" };
const documento: DocumentoRegistrado = { tipoDocumentoId: tipo.id, obligatorio: true, estado: "vigente", venceEl: fecha, notas: null };
const unidad: Unidad = { placa: "ABC123", numeroEconomico: null, tipo: "rabon", capacidadKg: 1000, rendimientoKmL: 5, activo: true, notas: null, documentos: [documento] };
const operador: Operador = { nombre: "Operador de prueba", telefono: null, activo: true, avisoVersion: "v1", avisoEntregadoEn: new Date("2026-10-01T12:00:00Z"), documentos: [documento] };

for (const entidad of ["unidad", "operador"] as const) {
  describe(`disponibilidad de ${entidad}`, () => {
    const revisar = (documentos = [documento], catalogo: TipoDocumento[] = [{ ...tipo, aplicaA: entidad }], activo = true) => entidad === "unidad"
      ? motivosNoDisponibleUnidad({ ...unidad, documentos, activo }, catalogo, fecha)
      : motivosNoDisponibleOperador({ ...operador, documentos, activo }, catalogo, fecha);

    it("está disponible al vencer hoy y bloquea al vencer ayer", () => {
      expect(revisar()).toEqual([]);
      expect(revisar([{ ...documento, venceEl: "2026-10-13" }])).toEqual([{ codigo: "documento_no_vigente", detalle: "Permiso" }]);
    });
    it("reporta inactivo", () => expect(revisar([documento], undefined, false)).toEqual([{ codigo: "inactivo", detalle: null }]));
    it("reporta faltante sin renglón", () => expect(revisar([])).toEqual([{ codigo: "documento_faltante", detalle: "Permiso" }]));
    it.each(["pendiente", "vencido"] as const)("reporta estado %s aunque la fecha sea futura", (estado) => {
      expect(revisar([{ ...documento, estado, venceEl: "2027-01-01" }])).toEqual([{ codigo: "documento_no_vigente", detalle: "Permiso" }]);
    });
    it("el obligatorio de la entidad anula al catálogo en ambos sentidos", () => {
      expect(revisar([{ ...documento, obligatorio: false, estado: "vencido" }])).toEqual([]);
      expect(revisar([{ ...documento, estado: "pendiente" }], [{ ...tipo, aplicaA: entidad, obligatorioPorOmision: false }])).toEqual([{ codigo: "documento_no_vigente", detalle: "Permiso" }]);
      expect(revisar([], [{ ...tipo, aplicaA: entidad, obligatorioPorOmision: false }])).toEqual([]);
    });
    it("ignora requisitos de otras entidades y admite documentos sin vencimiento", () => {
      expect(revisar([], [{ ...tipo, aplicaA: "cliente" }])).toEqual([]);
      expect(revisar([{ ...documento, venceEl: null }])).toEqual([]);
    });
    it("ordena por código y por nombre sin alterar entradas", () => {
      const catalogo = ["Zeta", "Alfa", "Yodo", "Beta"].map((nombre) => ({ ...tipo, aplicaA: entidad, id: nombre, nombre }));
      const documentos = ["Yodo", "Beta"].map((tipoDocumentoId) => ({ ...documento, tipoDocumentoId, estado: "pendiente" as const }));
      const antes = structuredClone({ catalogo, documentos });
      expect(revisar(documentos, catalogo, false)).toEqual([
        { codigo: "inactivo", detalle: null },
        { codigo: "documento_faltante", detalle: "Alfa" }, { codigo: "documento_faltante", detalle: "Zeta" },
        { codigo: "documento_no_vigente", detalle: "Beta" }, { codigo: "documento_no_vigente", detalle: "Yodo" },
      ]);
      expect({ catalogo, documentos }).toEqual(antes);
    });
  });
}

it("agrega aviso_no_entregado al final solo cuando la versión es null", () => {
  expect(motivosNoDisponibleOperador({ ...operador, activo: false, avisoVersion: null }, [], fecha)).toEqual([
    { codigo: "inactivo", detalle: null }, { codigo: "aviso_no_entregado", detalle: null },
  ]);
  expect(motivosNoDisponibleOperador(operador, [], fecha)).toEqual([]);
});

describe("documentos por vencer", () => {
  const docs = ["2026-10-13", fecha, "2026-11-13", "2026-11-14", null].map((venceEl) => ({ ...documento, venceEl }));
  it("incluye ambos límites de 30 días y excluye ayer, el día 31 y null", () => {
    expect(documentosPorVencer(docs, fecha, 30)).toEqual([docs[1], docs[2]]);
    expect(documentosPorVencer(docs, fecha, 0)).toEqual([docs[1]]);
  });
  it("cruza año y febrero bisiesto", () => {
    expect(documentosPorVencer([{ ...documento, venceEl: "2027-01-01" }], "2026-12-31", 1)).toHaveLength(1);
    expect(documentosPorVencer([{ ...documento, venceEl: "2028-03-01" }], "2028-02-28", 1)).toEqual([]);
  });
  it("selecciona por fecha incluso documentos opcionales o pendientes", () => {
    const pendiente = { ...documento, obligatorio: false, estado: "pendiente" as const };
    expect(documentosPorVencer([pendiente], fecha, 0)).toEqual([pendiente]);
  });
});

it("normaliza espacios, guiones y minúsculas de placa", () => expect(normalizarPlaca(" ab-c 12\t3\n")).toBe("ABC123"));
