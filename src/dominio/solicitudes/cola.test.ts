import { describe, expect, it, vi } from "vitest";
import { clienteNuevo } from "../clientes/formulario";
import type { Cliente } from "../clientes/tipos";
import { cargaEfectivaKg, colaDelDia, diasDeAtraso, formatoFolio, ordenFifo, siguienteDiaOperacion } from "./cola";
import type { SolicitudGuardada } from "./tipos";

const dias = [1, 2, 3, 4, 5];
const solicitud: SolicitudGuardada = {
  id: "s1", version: 1, folio: "S-20261012-001", clienteId: "c1", registradaEn: new Date("2026-10-12T15:00:00Z"),
  fechaSolicitada: "2026-10-12", proximaFechaElegible: "2026-10-14", canal: "telefono", cargaEstimadaKg: null,
  notas: null, estado: "pendiente", motivoCancelacion: null, vecesPospuesta: 2,
};
const cliente: Cliente = {
  ...clienteNuevo(), nombre: "Cliente sintético", lat: 20.61, lng: -100.28, tipoResiduo: "RME", tiposUnidadAdmitidos: ["rabon"],
  ventanas: [{ diaSemana: 3, horaInicio: "08:00", horaFin: "16:00" }],
  privacidad: { id: "p1", accion: "aceptado", versionAviso: "v1", medio: "papel", en: new Date("2026-10-01T12:00:00Z") },
};

describe("calendario de operación", () => {
  it.each([
    ["2026-10-16", dias, "2026-10-19"], ["2026-10-17", dias, "2026-10-19"],
    ["2026-10-12", [1, 4], "2026-10-15"], ["2026-10-15", [1, 4], "2026-10-19"],
    ["2026-10-12", [1], "2026-10-19"], ["2026-12-31", dias, "2027-01-01"],
    ["2028-02-28", [0, 1, 2, 3, 4, 5, 6], "2028-02-29"], ["2026-10-17", [0], "2026-10-18"],
  ])("siguiente a %s con %j es %s", (fecha, calendario, esperado) => expect(siguienteDiaOperacion(fecha, calendario)).toBe(esperado));
  it.each([{ calendario: [] }, { calendario: [7] }, { calendario: [-1] }, { calendario: [1.5] }])("rechaza calendario inválido %j", ({ calendario }) => {
    expect(() => siguienteDiaOperacion("2026-10-14", calendario)).toThrow();
  });
  it.each([
    ["2026-10-12", 0], ["2026-10-11", 0], ["2026-10-13", 1], ["2026-10-14", 2],
    ["2026-10-18", 4], ["2026-10-19", 5], ["2026-10-26", 10],
  ])("atraso al %s = %s", (hoy, esperado) => expect(diasDeAtraso(solicitud, hoy, dias)).toBe(esperado));
  it("cuenta solo días no consecutivos, sin duplicarlos", () => {
    expect(diasDeAtraso(solicitud, "2026-10-22", [1, 4, 4])).toBe(3);
  });
  it.each(["UTC", "America/Mexico_City", "Pacific/Kiritimati"])("no depende de la zona %s", (zona) => {
    vi.stubEnv("TZ", zona);
    try {
      expect(siguienteDiaOperacion("2026-10-16", dias)).toBe("2026-10-19");
      expect(diasDeAtraso(solicitud, "2026-10-14", dias)).toBe(2);
    } finally { vi.unstubAllEnvs(); }
  });
});

describe("FIFO y carga", () => {
  it("ordena por instante y luego folio, preserva empates completos y no muta", () => {
    const a = { ...solicitud, id: "a", folio: "S-20261012-002" };
    const b = { ...solicitud, id: "b" };
    const c = { ...b, id: "c" };
    const anterior = { ...a, id: "anterior", registradaEn: new Date("2026-10-11T15:00:00Z") };
    const entrada = [a, b, c, anterior];
    expect(ordenFifo(entrada)).toEqual([anterior, b, c, a]);
    expect(entrada).toEqual([a, b, c, anterior]);
    expect(ordenFifo([])).toEqual([]);
  });
  it.each([[200, 300, 200], [null, 300, 300], [null, null, 1000], [null, 0, 0]])("carga de solicitud %s y cliente %s produce %s", (cargaSolicitud, cargaCliente, esperada) => {
    expect(cargaEfectivaKg({ cargaEstimadaKg: cargaSolicitud }, { cargaEstimadaKg: cargaCliente }, 1000)).toBe(esperada);
  });
});

describe("cola del día", () => {
  const armar = (solicitudes: SolicitudGuardada[], ficha = cliente) => colaDelDia(solicitudes, new Map([["c1", ficha]]), "2026-10-14", "v1", dias, 2);
  it("clasifica lista y bloqueada, con atraso desde la fecha solicitada", () => {
    expect(armar([solicitud])[0]).toMatchObject({ estado: "lista", motivos: [], diasDeAtraso: 2, atrasada: true });
    expect(armar([solicitud], { ...cliente, activo: false })[0]).toMatchObject({ estado: "bloqueada", motivos: [{ codigo: "inactivo", detalle: null }], atrasada: true });
  });
  it("no marca atrasada antes del umbral", () => {
    expect(armar([{ ...solicitud, fechaSolicitada: "2026-10-13" }])[0]).toMatchObject({ diasDeAtraso: 1, atrasada: false });
  });
  it("futura tiene precedencia sobre bloqueo y no se marca atrasada", () => {
    expect(armar([{ ...solicitud, proximaFechaElegible: "2026-10-15" }], { ...cliente, activo: false })[0]).toMatchObject({ estado: "futura", motivos: [], diasDeAtraso: 2, atrasada: false });
  });
  it.each(["cancelada", "atendida", "no_atendida"] as const)("%s se clasifica cerrada antes que futura o bloqueada", (estado) => {
    expect(armar([{ ...solicitud, estado, proximaFechaElegible: "2026-10-15" }], { ...cliente, activo: false })[0]).toMatchObject({ estado: "cerrada", motivos: [], atrasada: false });
  });
  it("al corregir cliente vuelve a lista conservando registro y lugar FIFO", () => {
    const reciente = { ...solicitud, id: "s2", registradaEn: new Date("2026-10-13T15:00:00Z"), vecesPospuesta: 0 };
    const entrada = [reciente, solicitud];
    const antes = structuredClone(entrada);
    expect(armar(entrada, { ...cliente, privacidad: null }).map((e) => e.estado)).toEqual(["bloqueada", "bloqueada"]);
    const salida = armar(entrada);
    expect(salida.map((e) => e.solicitud.id)).toEqual(["s1", "s2"]);
    expect(salida.every((e) => e.estado === "lista")).toBe(true);
    expect(salida[0].solicitud).toBe(solicitud);
    expect(entrada).toEqual(antes);
  });
  it("no habilita solicitudes cuyo cliente falta y acepta cola vacía", () => {
    expect(() => colaDelDia([solicitud], new Map(), "2026-10-14", "v1", dias, 2)).toThrow("Falta el cliente");
    expect(armar([])).toEqual([]);
  });
});

it.each([[1, "001"], [999, "999"], [1000, "1000"]])("folio para consecutivo %s", (consecutivo, sufijo) => {
  expect(formatoFolio("2026-10-14", consecutivo)).toBe(`S-20261014-${sufijo}`);
});
