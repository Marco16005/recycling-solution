import { describe, expect, it } from "vitest";
import { clienteSchema } from "./esquemas";
import { aEntrada, clienteNuevo } from "./formulario";
import type { ClienteGuardado } from "./tipos";

describe("valores del formulario de cliente", () => {
  it("el formulario vacío solo falla por el nombre", () => {
    const r = clienteSchema.safeParse(clienteNuevo());
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path.join("."))).toEqual(["nombre"]);
  });

  it("un cliente guardado se convierte en una entrada válida, sin id, versión ni privacidad", () => {
    const guardado: ClienteGuardado = {
      ...clienteNuevo(),
      id: "00000000-0000-4000-8000-000000000001",
      version: 3,
      nombre: "Cartonera del Bajío",
      privacidad: { id: "00000000-0000-4000-8000-0000000000a1", accion: "aceptado", versionAviso: "2026-10", medio: "papel", en: new Date("2026-10-07T15:00:00Z") },
    };
    const entrada = aEntrada(guardado);
    expect(entrada).not.toHaveProperty("id");
    expect(entrada).not.toHaveProperty("version");
    expect(entrada).not.toHaveProperty("privacidad");
    expect(clienteSchema.safeParse(entrada).success).toBe(true);
  });
});

it("copia los tipos del catálogo y normaliza documentos antiguos sin mutar la ficha", () => {
  const documento = { nombre: "Documento sintético", obligatorio: true, estado: "vigente" as const, venceEl: null };
  const cliente: ClienteGuardado = {
    ...clienteNuevo(), id: "00000000-0000-4000-8000-000000000001", version: 1,
    nombre: "Cliente sintético", privacidad: null,
    documentos: [documento, { ...documento, tipoDocumentoId: "contrato_servicio" }],
  };
  const entrada = aEntrada(cliente);
  expect(entrada.documentos.map((d) => d.tipoDocumentoId)).toEqual([null, "contrato_servicio"]);
  expect(cliente.documentos[0]).not.toHaveProperty("tipoDocumentoId");
  expect(entrada.documentos[1]).not.toBe(cliente.documentos[1]);
  expect(clienteSchema.parse(entrada)).toEqual(entrada);
  expect(clienteNuevo().documentos).toEqual([]);
});
