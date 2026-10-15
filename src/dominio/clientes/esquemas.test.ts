import { describe, expect, it } from "vitest";
import { clienteSchema, documentoSchema, privacidadSchema, erroresPorCampo, type ClienteEntrada } from "./esquemas";

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
  documentos: [{
    tipoDocumentoId: null, nombre: "SUA vigente", obligatorio: true, estado: "vigente", venceEl: "2026-12-31",
  }],
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

describe("fechas de documentos", () => {
  it.each(["2026-02-30", "2026-13-01", "2026-02-29", "1900-02-29", "2026-04-31", "2026-00-10", "2026-01-00", "2026-1-01"])("rechaza %s", (venceEl) => {
    expect(documentoSchema.safeParse({ ...clienteValido.documentos[0], venceEl }).success).toBe(false);
  });

  it.each([null, "2026-02-28", "2028-02-29", "2000-02-29", "2026-12-31"])("acepta %s", (venceEl) => {
    expect(documentoSchema.safeParse({ ...clienteValido.documentos[0], venceEl }).success).toBe(true);
  });

  it("clienteSchema también rechaza una fecha imposible", () => {
    expect(errores({ ...clienteValido, documentos: [{ ...clienteValido.documentos[0], venceEl: "2026-02-30" }] })["documentos.0.venceEl"]).toBeDefined();
  });
});

describe("teléfonos", () => {
  it.each([null, "1234567890", "123456789012345", "+52 (442) 555-0101", "  (1) (2) (3) (4) (5) (6) (7) (8) (9) (0)  "])("acepta %s contando solo dígitos", (contactoTelefono) => {
    expect(errores({ ...clienteValido, contactoTelefono })).toEqual({});
  });

  it.each(["", "123456789", "1234567890123456", "+ () -", "4425550101 ext 2", "442.555.0101"])("rechaza %s", (contactoTelefono) => {
    expect(errores({ ...clienteValido, contactoTelefono }).contactoTelefono).toEqual(["Teléfono no válido"]);
  });
});

describe("privacidadSchema", () => {
  const entrada = { accion: "aceptado", medio: "papel", versionAviso: "v1", movimientoAnteriorId: null };

  it("acepta el primer movimiento y un movimiento con antecedente UUID", () => {
    expect(privacidadSchema.parse({ ...entrada, versionAviso: " v1 " })).toEqual(entrada);
    expect(privacidadSchema.safeParse({ ...entrada, accion: "retirado", medio: "correo", movimientoAnteriorId: "00000000-0000-4000-8000-000000000001" }).success).toBe(true);
  });

  it.each([
    { versionAviso: undefined }, { versionAviso: " " }, { versionAviso: "x".repeat(41) },
    { movimientoAnteriorId: undefined }, { movimientoAnteriorId: "incorrecto" },
    { accion: "otra" }, { medio: "mensaje" },
  ])("rechaza el movimiento inválido %j", (cambios) => {
    expect(privacidadSchema.safeParse({ ...entrada, ...cambios }).success).toBe(false);
  });
});

describe("tipo de documento del catálogo", () => {
  const documento = { nombre: "Documento sintético", obligatorio: true, estado: "vigente", venceEl: null };

  it.each([undefined, null])("normaliza %s a null para documentos libres", (tipoDocumentoId) => {
    expect(documentoSchema.parse({ ...documento, tipoDocumentoId }).tipoDocumentoId).toBeNull();
    expect(documentoSchema.parse(documento).tipoDocumentoId).toBeNull();
  });

  it("acepta identificadores de texto y recorta espacios sin exigir UUID", () => {
    expect(documentoSchema.parse({ ...documento, tipoDocumentoId: " contrato_servicio " }).tipoDocumentoId)
      .toBe("contrato_servicio");
  });

  it.each(["", "   ", 123, false, {}, []].map((tipoDocumentoId) => ({ tipoDocumentoId })))(
    "rechaza tipo inválido %j", ({ tipoDocumentoId }) => {
      const resultado = documentoSchema.safeParse({ ...documento, tipoDocumentoId });
      expect(resultado.success).toBe(false);
      if (!resultado.success) expect(resultado.error.issues[0].path).toEqual(["tipoDocumentoId"]);
    },
  );

  it("conserva el tipo al validar la ficha completa", () => {
    const resultado = clienteSchema.parse({
      ...clienteValido, documentos: [{ ...documento, tipoDocumentoId: "contrato_servicio" }],
    });
    expect(resultado.documentos[0].tipoDocumentoId).toBe("contrato_servicio");
  });
});
