import { describe, expect, it, vi } from "vitest";
import { diaSemanaDeFecha, motivosDeBloqueoCliente, type CodigoBloqueo } from "./habilitacion";
import { clienteNuevo } from "./formulario";
import type { Cliente } from "./tipos";

const habilitado: Cliente = {
  ...clienteNuevo(), nombre: "Cartonera de prueba", lat: 20.61, lng: -100.28,
  tipoResiduo: "RME", tiposUnidadAdmitidos: ["doble_rodada"],
  ventanas: [{ diaSemana: 1, horaInicio: "08:00", horaFin: "12:00" }],
  privacidad: { id: "00000000-0000-4000-8000-000000000001", accion: "aceptado", versionAviso: "v1", medio: "papel", en: new Date("2026-10-01T12:00:00Z") },
};
const documento = { nombre: "Permiso", obligatorio: true, estado: "vigente" as const, venceEl: "2026-10-12" };
const motivos = (c: Cliente) => motivosDeBloqueoCliente(c, "2026-10-12", "v1");

describe("motivosDeBloqueoCliente", () => {
  it("no bloquea un cliente habilitado", () => expect(motivos(habilitado)).toEqual([]));

  const casos: [CodigoBloqueo, Partial<Cliente>, string | null][] = [
    ["inactivo", { activo: false }, null],
    ["sin_ubicacion", { lng: null }, null],
    ["residuo_no_definido", { tipoResiduo: null }, null],
    ["residuo_peligroso", { tipoResiduo: "RP" }, null],
    ["documento_no_vigente", { documentos: [{ ...documento, estado: "pendiente" }] }, "Permiso"],
    ["sin_aviso_privacidad", { privacidad: null }, null],
    ["sin_ventana_ese_dia", { ventanas: [{ diaSemana: 2, horaInicio: "08:00", horaFin: "12:00" }] }, null],
    ["sin_tipos_unidad", { tiposUnidadAdmitidos: [] }, null],
  ];
  it.each(casos)("reporta solo %s", (codigo, cambios, detalle) => {
    expect(motivos({ ...habilitado, ...cambios })).toEqual([{ codigo, detalle }]);
  });

  it("conserva el orden de los motivos y el detalle de cada documento", () => {
    const c: Cliente = { ...habilitado, activo: false, lng: null, tipoResiduo: "RP", privacidad: null, ventanas: [], tiposUnidadAdmitidos: [], documentos: [
      { ...documento, estado: "pendiente" as const }, { ...documento, nombre: "Contrato", estado: "vencido" as const },
    ] };
    expect(motivos(c).map((m) => m.codigo)).toEqual(["inactivo", "sin_ubicacion", "residuo_peligroso", "documento_no_vigente", "documento_no_vigente", "sin_aviso_privacidad", "sin_ventana_ese_dia", "sin_tipos_unidad"]);
    expect(motivos(c).filter((m) => m.codigo === "documento_no_vigente").map((m) => m.detalle)).toEqual(["Permiso", "Contrato"]);
  });

  it("vence hoy sin bloquear; ayer bloquea; los opcionales no bloquean", () => {
    expect(motivos({ ...habilitado, documentos: [documento] })).toEqual([]);
    expect(motivos({ ...habilitado, documentos: [{ ...documento, venceEl: "2026-10-11" }] })).toEqual([{ codigo: "documento_no_vigente", detalle: "Permiso" }]);
    expect(motivos({ ...habilitado, documentos: [{ ...documento, obligatorio: false, estado: "vencido" }] })).toEqual([]);
  });

  it("bloquea el aviso retirado o de otra versión", () => {
    for (const privacidad of [{ ...habilitado.privacidad!, accion: "retirado" as const }, { ...habilitado.privacidad!, versionAviso: "v0" }]) {
      expect(motivos({ ...habilitado, privacidad })).toEqual([{ codigo: "sin_aviso_privacidad", detalle: null }]);
    }
  });
});

describe("diaSemanaDeFecha", () => {
  it.each(["UTC", "America/Mexico_City", "Pacific/Kiritimati"])("domingo y sábado no cambian en %s", (zona) => {
    vi.stubEnv("TZ", zona);
    try {
      expect(diaSemanaDeFecha("2026-10-11")).toBe(0);
      expect(diaSemanaDeFecha("2026-10-17")).toBe(6);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
