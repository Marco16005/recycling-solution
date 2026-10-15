import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { generarPlan } from "@/motor";
import { clienteNuevo } from "../clientes/formulario";
import type { ClienteGuardado } from "../clientes/tipos";
import type { UnidadGuardada } from "../flota/tipos";
import type { SolicitudGuardada } from "../solicitudes/tipos";
import { fechaEnMexico } from "../tiempo";
import { capacidadMaximaPorTipo, construirEntrada, ErrorDeEntrada, instanteDeMinutos, MARGEN_REVISION_MIN,
  minutoEnMexico, minutosDeHora, requisitosPorJornada, semillaDeFecha, TIPOS_REQUISITO_OPERADOR, ventanasDelDia } from "./entrada";
import type { ConfiguracionPlan } from "./tipos";

const configuracion: ConfiguracionPlan = {
  patioLat: 20.62, patioLng: -100.27, turnoInicio: "08:00", turnoFin: "16:00", velocidadKmh: 30,
  factorCircuidad: 1.3, descargaMin: 15, cargaPorOmisionKg: 1000, diasOperacion: [1, 2, 3, 4, 5],
  diasParaAtrasada: 2, versionAvisoPrivacidad: "v1",
};
const cliente: ClienteGuardado = {
  ...clienteNuevo(), id: "c1", version: 1, nombre: "Cliente sintético", lat: 20.62, lng: -100.27,
  privacidad: null, tiempoServicioMin: 20, tiposUnidadAdmitidos: ["rabon"], cargaEstimadaKg: 1200,
  ventanas: [{ diaSemana: 4, horaInicio: "08:00", horaFin: "16:00" }],
};
const unidad: UnidadGuardada = {
  id: "u1", version: 1, placa: "SINT-001", numeroEconomico: null, tipo: "rabon", capacidadKg: 8000,
  rendimientoKmL: 3, activo: true, notas: null, documentos: [],
};
const solicitud: SolicitudGuardada = {
  id: "s1", version: 1, folio: "S-20261015-001", clienteId: "c1", registradaEn: new Date("2026-10-15T13:00:00Z"),
  fechaSolicitada: "2026-10-15", proximaFechaElegible: "2026-10-15", canal: "telefono", cargaEstimadaKg: null,
  notas: null, estado: "pendiente", motivoCancelacion: null, vecesPospuesta: 0,
};
const datos = () => ({ fecha: "2026-10-15", ahora: new Date("2026-10-15T14:00:00Z"), configuracion: { ...configuracion },
  solicitudes: [{ solicitud: { ...solicitud }, cliente: structuredClone(cliente) }],
  jornadas: [{ jornadaId: "j1", disponibleDesde: "08:00:00", unidad: { ...unidad } }], unidadesActivas: [{ ...unidad }],
});

describe("horas y fechas del plan", () => {
  it.each([["00:00", 0], ["08:30", 510], ["08:30:00", 510], ["08:30:01", 511], ["23:59:59", 1440]])(
    "%s se convierte en %s minutos", (hora, esperado) => expect(minutosDeHora(hora)).toBe(esperado),
  );
  it.each(["24:00", "08:60", "08:00:60", "8:00", "no", "-1:00"])("rechaza %s", hora => expect(() => minutosDeHora(hora)).toThrow());
  it("la semilla es la fecha entera y rechaza fechas inexistentes", () => {
    expect(semillaDeFecha("2026-10-15")).toBe(20261015);
    expect(semillaDeFecha("2028-02-29")).toBe(20280229);
    expect(() => semillaDeFecha("2026-02-29")).toThrow();
  });
  it.each([
    ["2026-10-15T06:00:00Z", 0], ["2026-10-15T06:00:00.001Z", 1],
    ["2026-10-15T14:30:00Z", 510], ["2026-10-15T14:30:01Z", 511],
    ["2026-10-16T05:59:59Z", 1440], ["2026-10-16T01:00:00Z", 1140],
  ])("minuto en México de %s", (iso, esperado) => expect(minutoEnMexico(new Date(iso))).toBe(esperado));
  it.each([
    ["2026-10-15", 0, "2026-10-15T06:00:00.000Z"],
    ["2026-10-31", 1439, "2026-11-01T05:59:00.000Z"],
    ["2026-12-31", 1440, "2027-01-01T06:00:00.000Z"],
    ["2028-02-29", 1440, "2028-03-01T06:00:00.000Z"],
    ["2026-10-15", -1, "2026-10-15T05:59:00.000Z"],
    // En 2021 el desfase de verano era distinto: no sirve sumar seis horas fijas.
    ["2021-07-01", 480, "2021-07-01T13:00:00.000Z"],
    ["2021-01-01", 480, "2021-01-01T14:00:00.000Z"],
  ])("instante de %s + %s", (fecha, minutos, esperado) => expect(instanteDeMinutos(fecha, minutos).toISOString()).toBe(esperado));
  it.each(["UTC", "America/Mexico_City", "Pacific/Kiritimati"])("no depende de TZ=%s", zona => {
    vi.stubEnv("TZ", zona);
    try {
      expect(instanteDeMinutos("2026-10-31", 1200).toISOString()).toBe("2026-11-01T02:00:00.000Z");
      expect(minutoEnMexico(new Date("2026-11-01T02:00:00Z"))).toBe(1200);
    } finally { vi.unstubAllEnvs(); }
  });
  it("ida y vuelta de todos los minutos del día en distintas fechas", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 364 }), fc.integer({ min: 0, max: 1439 }), (dia, minuto) => {
      const fecha = new Date(Date.UTC(2026, 0, 1 + dia)).toISOString().slice(0, 10);
      const instante = instanteDeMinutos(fecha, minuto);
      expect(fechaEnMexico(instante)).toBe(fecha);
      expect(minutoEnMexico(instante)).toBe(minuto);
    }), { seed: 20261015, numRuns: 200 });
  });
  it("rechaza la hora inexistente del salto estacional histórico", () => {
    expect(() => instanteDeMinutos("2021-04-04", 150)).toThrow("Hora local inexistente");
  });
  it("selecciona ventanas por el día mexicano y las ordena sin mutar", () => {
    const c = { ...cliente, ventanas: [
      { diaSemana: 4, horaInicio: "14:00", horaFin: "16:00" },
      { diaSemana: 5, horaInicio: "09:00", horaFin: "10:00" },
      { diaSemana: 4, horaInicio: "08:00", horaFin: "12:00" },
    ] };
    const antes = structuredClone(c);
    expect(ventanasDelDia(c, "2026-10-15")).toEqual([{ inicioMin: 480, finMin: 720 }, { inicioMin: 840, finMin: 960 }]);
    expect(ventanasDelDia(c, "2026-10-17")).toEqual([]);
    expect(c).toEqual(antes);
  });
});

describe("construirEntrada", () => {
  it("convierte datos, añade margen y usa jornadaId como unidad del motor", () => {
    const d = datos();
    const antes = structuredClone(d);
    const e = construirEntrada(d);
    expect(e.instanteMin).toBe(480 + MARGEN_REVISION_MIN);
    expect(e.unidades[0]).toEqual({ id: "j1", tipo: "rabon", capacidadKg: 8000,
      ubicacionInicial: { lat: 20.62, lng: -100.27 }, libreDesdeMin: 490, cargaActualKg: 0 });
    expect(e.solicitudes[0]).toMatchObject({ id: "s1", clienteId: "c1", registradaEn: "2026-10-15T13:00:00.000Z", cargaKg: 1200,
      ventanas: [{ inicioMin: 480, finMin: 960 }], tiempoServicioMin: 20, tiposUnidadAdmitidos: ["rabon"] });
    expect(e.parametros).toMatchObject({ semilla: 20261015, turnoInicioMin: 480, turnoFinMin: 960 });
    expect(generarPlan(e).resumen.ruteadas).toBe(1);
    expect(d).toEqual(antes);
  });
  it("respeta inicio de turno, disponibilidad posterior y fechas futuras", () => {
    const d = datos();
    d.ahora = new Date("2026-10-15T12:00:00Z");
    d.jornadas[0].disponibleDesde = "09:00:01";
    expect(construirEntrada(d)).toMatchObject({ instanteMin: 480, unidades: [{ libreDesdeMin: 541 }] });
    d.ahora = new Date("2026-10-14T22:00:00Z");
    expect(construirEntrada(d).instanteMin).toBe(480);
    d.ahora = new Date("2026-10-15T14:30:01Z");
    expect(construirEntrada(d).instanteMin).toBe(521);
  });
  it("usa hoy en México aunque UTC ya sea mañana; no reinicia el minuto redondeado", () => {
    const d = datos();
    d.ahora = new Date("2026-10-16T05:59:59Z");
    expect(construirEntrada(d).instanteMin).toBe(1450);
    d.ahora = new Date("2026-10-16T06:00:00Z");
    expect(() => construirEntrada(d)).toThrow(ErrorDeEntrada);
    try { construirEntrada(d); } catch (e) { expect(e).toMatchObject({ codigo: "fecha_pasada" }); }
  });
  it("informa falta de patio y fecha pasada", () => {
    const d = datos();
    d.configuracion.patioLat = null;
    expect(() => construirEntrada(d)).toThrow("sin_patio");
    d.configuracion = { ...configuracion, patioLng: null };
    expect(() => construirEntrada(d)).toThrow("sin_patio");
    d.configuracion = { ...configuracion };
    d.fecha = "2026-10-14";
    expect(() => construirEntrada(d)).toThrow("fecha_pasada");
  });
  it.each([[300, 1200, 300], [null, 1200, 1200], [null, null, 1000]] as const)("resuelve cargas %s / %s", (capturada, estimada, esperado) => {
    const d = datos();
    d.solicitudes[0].solicitud.cargaEstimadaKg = capturada;
    d.solicitudes[0].cliente.cargaEstimadaKg = estimada;
    expect(construirEntrada(d).solicitudes[0].cargaKg).toBe(esperado);
  });
  it("usa el catálogo activo completo aunque no tenga jornada o documentos vigentes", () => {
    const d = datos();
    d.unidadesActivas.push({ ...unidad, id: "sin-jornada", capacidadKg: 14000,
      documentos: [{ tipoDocumentoId: "seguro", obligatorio: true, estado: "vencido", venceEl: "2020-01-01", notas: null }] });
    d.unidadesActivas.push({ ...unidad, id: "inactiva", capacidadKg: 20000, activo: false });
    expect(construirEntrada(d).parametros.capacidadMaximaPorTipoKg).toEqual({ doble_rodada: 0, rabon: 14000, camioneta: 0 });
    expect(capacidadMaximaPorTipo([])).toEqual({ doble_rodada: 0, rabon: 0, camioneta: 0 });
  });
});

it("requisitos por jornada: solo obligatorios del catálogo del operador, sin duplicar clientes ni tipos", () => {
  const d = datos();
  const doc = { nombre: "Inducción", tipoDocumentoId: TIPOS_REQUISITO_OPERADOR[0], obligatorio: true, estado: "vigente" as const, venceEl: null };
  d.solicitudes[0].cliente.documentos = [doc, { ...doc }];
  d.solicitudes.push({ solicitud: { ...solicitud, id: "s2" }, cliente: d.solicitudes[0].cliente });
  d.jornadas.push({ jornadaId: "j2", disponibleDesde: "08:00", unidad: { ...unidad, id: "u2" } });
  const p = generarPlan(construirEntrada(d));
  const clientes = new Map(d.solicitudes.map(s => [s.solicitud.id, s.cliente]));
  const requisitos = requisitosPorJornada(p, clientes);
  expect([...requisitos.values()].flat()).toEqual([{ clienteId: "c1", nombre: cliente.nombre, tipos: [doc.tipoDocumentoId] }]);
  expect(requisitos.size).toBe(2);
  d.solicitudes[0].cliente.documentos = [{ ...doc, obligatorio: false }, { ...doc, tipoDocumentoId: null }];
  expect([...requisitosPorJornada(p, clientes).values()].flat()).toEqual([]);
  expect(() => requisitosPorJornada(p, new Map())).toThrow("Falta el cliente");
});
