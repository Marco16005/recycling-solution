import { describe, expect, it } from "vitest";
import { clienteSchema, erroresPorCampo, type ClienteEntrada } from "./esquemas";

export const clienteValido: ClienteEntrada = {
  nombre: "Cartonera del Bajío",
  contactoNombre: "Laura Méndez",
  contactoTelefono: "442 555 0101",
  direccion: "Av. del Marqués 100, El Marqués, Qro.",
  lat: 20.6102,
  lng: -100.2801,
  tipoResiduo: "RME",
  material: "Cartón nacional",
  tiposUnidadAdmitidos: ["doble_rodada"],
  notasAcceso: "Registro en caseta; casco y chaleco",
  tiempoServicioMin: 66,
  cargaEstimadaKg: 1800,
  activo: true,
  ventanas: [{ diaSemana: 1, horaInicio: "08:00", horaFin: "12:00" }],
  documentos: [{ nombre: "SUA vigente", obligatorio: true, estado: "vigente", venceEl: "2026-12-31" }],
};

function errores(entrada: unknown) {
  const r = clienteSchema.safeParse(entrada);
  return r.success ? {} : erroresPorCampo(r.error);
}

describe("clienteSchema", () => {
  it("acepta un cliente válido y recorta espacios", () => {
    const r = clienteSchema.safeParse({ ...clienteValido, nombre: "  Cartonera del Bajío  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.nombre).toBe("Cartonera del Bajío");
  });

  it("acepta un cliente apenas dado de alta, sin ubicación ni ventanas", () => {
    const minimo = { ...clienteValido, lat: null, lng: null, tipoResiduo: null, tiposUnidadAdmitidos: [], ventanas: [], documentos: [] };
    expect(errores(minimo)).toEqual({});
  });

  it("rechaza coordenadas invertidas (latitud y longitud intercambiadas)", () => {
    const e = errores({ ...clienteValido, lat: -100.2801, lng: 20.6102 });
    expect(e.lat).toEqual(["Latitud fuera de México"]);
    expect(e.lng).toEqual(["Longitud fuera de México"]);
  });

  it("rechaza una coordenada sin la otra", () => {
    expect(errores({ ...clienteValido, lng: null }).lat).toEqual(["Latitud y longitud se capturan juntas"]);
  });

  it("rechaza una ventana que cruza la medianoche", () => {
    const e = errores({ ...clienteValido, ventanas: [{ diaSemana: 1, horaInicio: "22:00", horaFin: "02:00" }] });
    expect(e["ventanas.0.horaFin"]?.[0]).toMatch(/medianoche/);
  });

  it("rechaza ventanas que se traslapan el mismo día, pero no en días distintos", () => {
    const traslape = [
      { diaSemana: 1, horaInicio: "08:00", horaFin: "12:00" },
      { diaSemana: 1, horaInicio: "11:00", horaFin: "14:00" },
    ];
    expect(errores({ ...clienteValido, ventanas: traslape }).ventanas).toEqual(["Hay ventanas que se traslapan en el mismo día"]);
    const diasDistintos = [traslape[0], { ...traslape[1], diaSemana: 2 }];
    expect(errores({ ...clienteValido, ventanas: diasDistintos })).toEqual({});
  });

  it("acepta ventanas contiguas (una termina cuando empieza la otra)", () => {
    const contiguas = [
      { diaSemana: 1, horaInicio: "08:00", horaFin: "12:00" },
      { diaSemana: 1, horaInicio: "12:00", horaFin: "15:00" },
    ];
    expect(errores({ ...clienteValido, ventanas: contiguas })).toEqual({});
  });

  it("rechaza teléfono con letras y tiempo de servicio fuera de rango", () => {
    const e = errores({ ...clienteValido, contactoTelefono: "llamar a Laura", tiempoServicioMin: 0 });
    expect(e.contactoTelefono).toEqual(["Teléfono no válido"]);
    expect(e.tiempoServicioMin).toBeDefined();
  });
});
