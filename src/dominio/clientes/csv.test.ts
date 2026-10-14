import { describe, expect, it } from "vitest";
import { analizarClientesCsv, LIMITES_CSV, nombreNormalizado, posiblesDuplicados } from "./csv";

describe("analizarClientesCsv", () => {
  it("acepta BOM, punto y coma, coma decimal y renglones vacíos", () => {
    const r = analizarClientesCsv('\uFEFF NOMBRE ;lat;lng;residuo\r\nCartonera;20,61;-100,28;rme\r\n\r\n;;;\r\nOtra;;;\r\n');
    expect(r.errores).toEqual([]);
    expect(r.registros).toBe(2);
    expect(r.validas.map((v) => v.fila)).toEqual([2, 5]);
    expect(r.validas[0].entrada).toMatchObject({ lat: 20.61, lng: -100.28, tipoResiduo: "RME", tiempoServicioMin: 66, ventanas: [], documentos: [], tiposUnidadAdmitidos: [] });
  });

  it("conserva campos multilínea y cuenta filas de Excel, incluidos vacíos", () => {
    const r = analizarClientesCsv('nombre,direccion,residuo\nUno,"Calle uno\nPuerta dos",RME\n\nMalo,,XYZ\n');
    expect(r.validas[0]).toMatchObject({ fila: 2, entrada: { direccion: "Calle uno\nPuerta dos" } });
    expect(r.errores).toEqual([{ fila: 4, mensajes: [expect.stringContaining("tipoResiduo")] }]);
    expect(r.registros).toBe(2);
  });

  it.each([
    ['nombre,direccion\nUno,"Sin cerrar', /comillas sin cerrar/],
    ['nombre,residuo\nUno,RME,sobra', /número de campos/],
    ['nombre,residuo\nUno', /número de campos/],
  ])("reporta errores de lectura en la fila afectada: %s", (csv, mensaje) => {
    const r = analizarClientesCsv(csv);
    expect(r.validas).toEqual([]);
    expect(r.errores).toEqual([{ fila: 2, mensajes: expect.arrayContaining([expect.stringMatching(mensaje)]) }]);
  });

  it("rechaza encabezados repetidos tras normalizar", () => {
    expect(analizarClientesCsv("nombre, NOMBRE \nUno,Dos").errores).toEqual([{ fila: null, mensajes: ["Hay encabezados repetidos"] }]);
  });

  it("rechaza archivos sin nombre, incluidos los vacíos", () => {
    for (const csv of ["", "cliente,lat\nUno,20"]) {
      expect(analizarClientesCsv(csv).errores).toEqual([{ fila: null, mensajes: ['Falta la columna obligatoria "nombre"'] }]);
    }
  });

  it("valida cada fila con clienteSchema", () => {
    const r = analizarClientesCsv("nombre,telefono,lat,lng,servicio_min\nUno,123,90,-100,4\nDos,4425550101,20,-100,66");
    expect(r.registros).toBe(2);
    expect(r.validas.map((v) => v.fila)).toEqual([3]);
    expect(r.errores[0].mensajes).toEqual(expect.arrayContaining([expect.stringContaining("contactoTelefono"), expect.stringContaining("lat"), expect.stringContaining("tiempoServicioMin")]));
  });

  it("acepta 2000 registros y rechaza 2001 sin contar vacíos", () => {
    const csv = "nombre\n" + "Cliente\n".repeat(LIMITES_CSV.registros);
    expect(analizarClientesCsv(csv).validas).toHaveLength(2000);
    const r = analizarClientesCsv(csv + "\nOtro");
    expect(r.registros).toBe(2001);
    expect(r.validas).toEqual([]);
    expect(r.errores).toContainEqual({ fila: null, mensajes: [expect.stringContaining("2000 registros")] });
  });

  it("mide el límite en bytes UTF-8: acepta 1 MB y rechaza 1 MB + 1 byte", () => {
    const inicio = "nombre,ignorada\nUno,";
    const resto = LIMITES_CSV.bytes - new TextEncoder().encode(inicio).byteLength;
    const csv = inicio + "á".repeat(Math.floor(resto / 2)) + "x".repeat(resto % 2);
    expect(new TextEncoder().encode(csv).byteLength).toBe(LIMITES_CSV.bytes);
    expect(analizarClientesCsv(csv).errores).toEqual([]);
    expect(analizarClientesCsv(csv + "x")).toEqual({ validas: [], registros: 0, errores: [{ fila: null, mensajes: [expect.stringContaining("bytes")] }] });
  });
});

describe("posiblesDuplicados", () => {
  it("normaliza acentos, signos, mayúsculas y espacios", () => {
    expect(nombreNormalizado("  Cartonera  Núñez S.A. ")).toBe("cartonera nunez sa");
  });

  it("reporta coincidencias del archivo y cartera en orden estable sin modificar entradas", () => {
    const validas = analizarClientesCsv("nombre\nCartonera  Núñez S.A.\ncartonera nunez sa\nOtra\nCARTONERA NUNEZ SA").validas.reverse();
    const cartera = [{ id: "b", nombre: "Cartonera Núñez SA" }, { id: "a", nombre: "cartonera nunez sa" }];
    const r = posiblesDuplicados(validas, cartera);
    expect(r.map((d) => [d.fila, d.con, d.con === "archivo" ? d.otraFila : d.clienteId])).toEqual([
      [2, "cartera", "a"], [2, "cartera", "b"], [3, "archivo", 2], [3, "cartera", "a"], [3, "cartera", "b"],
      [5, "archivo", 2], [5, "archivo", 3], [5, "cartera", "a"], [5, "cartera", "b"],
    ]);
    expect(r[0]).toMatchObject({ nombre: "Cartonera  Núñez S.A.", nombreExistente: "cartonera nunez sa" });
    expect(validas.map((v) => v.fila)).toEqual([5, 4, 3, 2]);
    expect(cartera.map((c) => c.id)).toEqual(["b", "a"]);
  });
});
