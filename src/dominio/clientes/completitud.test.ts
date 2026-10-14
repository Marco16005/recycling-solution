import { describe, expect, it } from "vitest";
import { avisoVigente, estaCompleto, faltantesDeCliente, resumenK5 } from "./completitud";
import type { Cliente, EstadoPrivacidad } from "./tipos";

const VERSION = "2026-10";

const aceptado: EstadoPrivacidad = { id: "00000000-0000-4000-8000-0000000000a1", accion: "aceptado", versionAviso: VERSION, medio: "papel", en: new Date("2026-10-01T15:00:00Z") };

const completo: Cliente = {
  nombre: "Cartonera del Bajío",
  contactoNombre: null,
  contactoTelefono: null,
  direccion: null,
  lat: 20.61,
  lng: -100.28,
  tipoResiduo: "RME",
  material: null,
  tiposUnidadAdmitidos: ["doble_rodada"],
  notasAcceso: null,
  tiempoServicioMin: 66,
  cargaEstimadaKg: null,
  activo: true,
  ventanas: [{ diaSemana: 1, horaInicio: "08:00", horaFin: "12:00" }],
  documentos: [],
  privacidad: aceptado,
};

describe("completitud del cliente", () => {
  it("un cliente con todos los datos obligatorios está completo", () => {
    expect(faltantesDeCliente(completo, VERSION)).toEqual([]);
    expect(estaCompleto(completo, VERSION)).toBe(true);
  });

  it("lista cada dato que falta, en orden fijo", () => {
    const vacio: Cliente = { ...completo, lat: null, lng: null, ventanas: [], tipoResiduo: null, tiposUnidadAdmitidos: [], privacidad: null };
    expect(faltantesDeCliente(vacio, VERSION)).toEqual(["ubicacion", "ventana", "tipo_residuo", "tipos_unidad", "aviso_privacidad"]);
  });

  it("una coordenada sin la otra cuenta como ubicación faltante", () => {
    expect(faltantesDeCliente({ ...completo, lng: null }, VERSION)).toEqual(["ubicacion"]);
  });

  it("el aviso retirado o de una versión anterior no cuenta", () => {
    expect(avisoVigente(aceptado, VERSION)).toBe(true);
    expect(avisoVigente({ ...aceptado, accion: "retirado" }, VERSION)).toBe(false);
    expect(avisoVigente({ ...aceptado, versionAviso: "2025-01" }, VERSION)).toBe(false);
    expect(avisoVigente(null, VERSION)).toBe(false);
  });

  it("K5 solo cuenta clientes activos", () => {
    const incompleto = { ...completo, tipoResiduo: null };
    const inactivoIncompleto = { ...incompleto, activo: false };
    expect(resumenK5([completo, incompleto, inactivoIncompleto], VERSION)).toEqual({ activos: 2, completos: 1, porcentaje: 50 });
  });

  it("K5 sin clientes activos es 0", () => {
    expect(resumenK5([], VERSION)).toEqual({ activos: 0, completos: 0, porcentaje: 0 });
  });
});
