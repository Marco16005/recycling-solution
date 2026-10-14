import { describe, expect, it } from "vitest";
import { documentosQueBloquean, estadoEfectivo } from "./documentos";
import type { DocumentoCliente } from "./tipos";

const doc = (p: Partial<DocumentoCliente>): DocumentoCliente => ({
  nombre: "SUA", obligatorio: true, estado: "vigente", venceEl: null, ...p,
});

describe("documentos del cliente", () => {
  it("un documento vigente con fecha de vencimiento pasada cuenta como vencido", () => {
    expect(estadoEfectivo(doc({ venceEl: "2026-10-06" }), "2026-10-07")).toBe("vencido");
  });

  it("el día del vencimiento todavía es vigente", () => {
    expect(estadoEfectivo(doc({ venceEl: "2026-10-07" }), "2026-10-07")).toBe("vigente");
  });

  it("sin fecha de vencimiento conserva su estado", () => {
    expect(estadoEfectivo(doc({ estado: "pendiente" }), "2026-10-07")).toBe("pendiente");
  });

  it("solo bloquean los obligatorios que no están vigentes", () => {
    const docs = [
      doc({ nombre: "SUA" }),
      doc({ nombre: "Póliza", estado: "pendiente" }),
      doc({ nombre: "Opcional", obligatorio: false, estado: "vencido" }),
      doc({ nombre: "Licencia", venceEl: "2026-01-01" }),
    ];
    expect(documentosQueBloquean(docs, "2026-10-07")).toEqual(["Póliza", "Licencia"]);
  });
});
