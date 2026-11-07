import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { analizarClientesCsv, COLUMNAS_CSV, filaCsvDeCliente, LIMITES_CSV, nombreNormalizado, posiblesDuplicados } from "./csv";

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

  it("importa el teléfono, las notas y los números que produce la exportación protegida", () => {
    const r = analizarClientesCsv("nombre,telefono,notas_acceso,lat,lng,servicio_min\r\nCartonera,'+52 442 123 4567,'=SUMA(A1),20.62,-100.3,+5\r\n");
    expect(r.errores).toEqual([]);
    expect(r.validas).toHaveLength(1);
    expect(r.validas[0].entrada).toMatchObject({
      contactoTelefono: "+52 442 123 4567", notasAcceso: "=SUMA(A1)", lat: 20.62, lng: -100.3, tiempoServicioMin: 5,
    });
  });

  it.each([
    ["''Los Pinos'", "'Los Pinos'"],
    ["'hola", "'hola"],
    ["'''Los Pinos'", "''Los Pinos'"],
    ["'=SUMA(A1)", "=SUMA(A1)"],
    ["'+texto", "+texto"],
    ["'-texto", "-texto"],
    ["'@texto", "@texto"],
    ["'\ttexto", "texto"],
    ["'\rtexto", "texto"],
    ["'", "'"],
  ])("quita un solo apóstrofo protector en texto: %s", (exportado, esperado) => {
    // Las celdas van entre comillas CSV; tabulador y retorno se recortan como antes.
    const r = analizarClientesCsv(`nombre,notas_acceso\r\nCartonera,"${exportado}"\r\n`);
    expect(r.errores).toEqual([]);
    expect(r.validas[0].entrada.notasAcceso).toBe(esperado);
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
    expect(analizarClientesCsv(csv + "x")).toEqual({ validas: [], registros: 0, avisos: [], errores: [{ fila: null, mensajes: [expect.stringContaining("bytes")] }] });
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
      [2, "cartera", "a"], [3, "archivo", 2], [3, "cartera", "a"], [5, "archivo", 2], [5, "cartera", "a"],
    ]);
    expect(r[0]).toMatchObject({ nombre: "Cartonera  Núñez S.A.", nombreExistente: "cartonera nunez sa" });
    expect(validas.map((v) => v.fila)).toEqual([5, 4, 3, 2]);
    expect(cartera.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("acota a 3999 avisos una importación con 2000 filas y 2000 clientes iguales en menos de 500 ms", () => {
    const entrada = analizarClientesCsv("nombre\nCliente").validas[0].entrada;
    const validas = Array.from({ length: 2000 }, (_, i) => ({ fila: i + 2, entrada })).reverse();
    const cartera = Array.from({ length: 2000 }, (_, i) => ({ id: `c-${String(1999 - i).padStart(4, "0")}`, nombre: "Cliente" }));

    const inicio = performance.now();
    const avisos = posiblesDuplicados(validas, cartera);
    const duracionMs = performance.now() - inicio;

    expect(duracionMs).toBeLessThan(500);
    expect(avisos).toHaveLength(3999);
    const archivo = avisos.filter((aviso) => aviso.con === "archivo");
    const carteraAvisos = avisos.filter((aviso) => aviso.con === "cartera");
    expect(archivo).toHaveLength(1999);
    expect(carteraAvisos).toHaveLength(2000);
    expect(archivo.every((aviso) => aviso.otraFila === 2)).toBe(true);
    expect(carteraAvisos.every((aviso) => aviso.clienteId === "c-0000")).toBe(true);
  });

  it("da como máximo un aviso de cada tipo por fila y señala la primera fila repetida", () => {
    const entrada = analizarClientesCsv("nombre\nBase").validas[0].entrada;
    const nombre = fc.constantFrom("Cartonera Núñez S.A.", "cartonera nunez sa", "Otra", "otra!", "Única", " unica ");
    fc.assert(fc.property(
      fc.array(nombre, { maxLength: 60 }), fc.array(nombre, { maxLength: 30 }), fc.boolean(),
      (nombres, nombresCartera, invertir) => {
        const validas = nombres.map((nombre, i) => ({ fila: i * 3 + 2, entrada: { ...entrada, nombre } }));
        if (invertir) validas.reverse();
        const cartera = nombresCartera.map((nombre, i) => ({ id: String(100 - i), nombre }));
        const avisos = posiblesDuplicados(validas, cartera);
        expect(avisos.length).toBeLessThanOrEqual(2 * validas.length);

        const porFila = new Map<number, typeof avisos>();
        for (const aviso of avisos) porFila.set(aviso.fila, [...(porFila.get(aviso.fila) ?? []), aviso]);
        const primeras = new Map<string, number>();
        for (const { fila, entrada } of [...validas].sort((a, b) => a.fila - b.fila)) {
          const normalizado = nombreNormalizado(entrada.nombre);
          const deFila = porFila.get(fila) ?? [];
          const archivo = deFila.filter((aviso) => aviso.con === "archivo");
          const deCartera = deFila.filter((aviso) => aviso.con === "cartera");
          const primera = primeras.get(normalizado);
          expect(archivo).toEqual(primera === undefined ? [] : [{ fila, nombre: entrada.nombre, con: "archivo", otraFila: primera }]);
          if (primera === undefined) primeras.set(normalizado, fila);
          expect(deCartera.length).toBeLessThanOrEqual(1);
        }
      },
    ), { seed: 20261104, numRuns: 200 });
  });
});

describe("columnas del Plan CRM", () => {
  const encabezado = "nombre,contacto,telefono,correo,puesto,direccion,ubicacion,residuo,material,servicio_min,carga_kg,horarios,tipos_unidad,notas_acceso";
  it("acepta claves y etiquetas con acentos, mayúsculas y espacios, y exporta claves", () => {
    const r = analizarClientesCsv('nombre,tipos_unidad\nCartonera," TrÁiLeR | RABÓN | Doble   rodada | doble_rodada | Torton | camioneta "\n');
    expect(r.errores).toEqual([]);
    const entrada = r.validas[0].entrada;
    expect(entrada.tiposUnidadAdmitidos).toEqual(["trailer", "rabon", "doble_rodada", "torton", "camioneta"]);
    expect(filaCsvDeCliente({ ...entrada, id: "x", version: 1, privacidad: null } as never).tipos_unidad)
      .toBe("trailer|rabon|doble_rodada|torton|camioneta");
  });
  it("rechaza un tipo desconocido incluso entre etiquetas válidas", () => {
    const r = analizarClientesCsv('nombre,tipos_unidad\nCartonera,"Tráiler | camión"\n');
    expect(r.validas).toEqual([]);
    expect(r.errores).toEqual([{ fila: 2, mensajes: [expect.stringContaining("camión")] }]);
  });
  it("lee horarios, tipos, notas, ubicación pegada, correo y puesto", () => {
    const r = analizarClientesCsv(`${encabezado}\nCartonera,Ana,4421234567,ana@ejemplo.test,Almacén,Calle 1,"20.62, -100.3",RME,Cartón,30,800,"lun-vie 08:00-14:00",doble_rodada|rabon,Tocar en caseta\n`);
    expect(r.errores).toEqual([]);
    expect(r.validas[0].entrada).toMatchObject({
      contactoCorreo: "ana@ejemplo.test", contactoPuesto: "Almacén", lat: 20.62, lng: -100.3, notasAcceso: "Tocar en caseta",
      tiposUnidadAdmitidos: ["doble_rodada", "rabon"], ventanas: expect.arrayContaining([{ diaSemana: 1, horaInicio: "08:00", horaFin: "14:00" }]),
    });
  });
  it("marca horarios no reconocidos, tipos desconocidos, enlace corto y ubicación distinta de lat/lng", () => {
    const filas = [
      'Uno,"lunes a viernes 8-2",,',
      'Dos,,camion,',
      'Tres,,,https://maps.app.goo.gl/abc',
    ];
    const r = analizarClientesCsv(`nombre,horarios,tipos_unidad,ubicacion\n${filas.join("\n")}\n`);
    expect(r.errores.map((e) => [e.fila, e.mensajes.join(" ")])).toEqual([
      [2, expect.stringContaining("Horario no reconocido")],
      [3, expect.stringContaining("Tipo de unidad no reconocido")],
      [4, expect.stringContaining("Enlace corto")],
    ]);
    const distinta = analizarClientesCsv("nombre,lat,lng,ubicacion\nUno,20.62,-100.3,\"20.70,-100.40\"\n");
    expect(distinta.errores[0].mensajes.join(" ")).toContain("no coincide");
  });
  it("un archivo en Windows-1252 conserva los acentos", () => {
    const bytes = new Uint8Array([...new TextEncoder().encode("nombre,direccion\nCartonera,Quer"), 0xe9, ...new TextEncoder().encode("taro\n")]);
    expect(analizarClientesCsv(bytes).validas[0].entrada.direccion).toBe("Querétaro");
  });
  it("ida y vuelta: filaCsvDeCliente se vuelve a leer con los mismos datos", () => {
    const r = analizarClientesCsv(`${encabezado}\nCartonera,Ana,4421234567,ana@ejemplo.test,Almacén,Calle 1,"20.62, -100.3",RME,Cartón,30,800,"lun-vie 08:00-14:00; sab 09:00-12:00",doble_rodada,Caseta\n`);
    const entrada = r.validas[0].entrada;
    const fila = filaCsvDeCliente({ ...entrada, id: "x", version: 1, privacidad: null } as never);
    const csv = [COLUMNAS_CSV.join(","), COLUMNAS_CSV.map((c) => `"${fila[c].replaceAll('"', '""')}"`).join(",")].join("\n");
    expect(analizarClientesCsv(csv).validas[0].entrada).toEqual(entrada);
  });
});
