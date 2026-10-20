import { expect, it } from "vitest";
import fc from "fast-check";
import { crearTraslados, llegadaConHorasPico, validarFranjas } from "./traslados";
import { entrada } from "./ejemplos.test-datos";
import type { FranjaPico } from "./tipos";

const pico = [{ inicioMin: 420, finMin: 570, factor: 1.3 }];
it.each<[number, number, FranjaPico[] | undefined, number]>([
  [480, 12.2, undefined, 493], [400, 26, pico, 428], [560, 20, pico, 583],
  [450, 10, pico, 463], [569, 1, pico, 571], [570, 1, pico, 571],
  [480, 0, pico, 480], [480, 0.0000001, pico, 481],
])("llegada(%d, %d) con franjas %j = %d", (s, m, f, esperado) => {
  expect(llegadaConHorasPico(s, m, f)).toBe(esperado);
});
it("salir más tarde nunca adelanta la llegada", () => {
  const franjas = fc.array(fc.integer({ min: 1, max: 3 }), { maxLength: 12 })
    .map(fs => fs.map((factor, i) => ({ inicioMin: i * 120, finMin: i * 120 + 90, factor })));
  fc.assert(fc.property(franjas, fc.integer({ min: 0, max: 1400 }), fc.integer({ min: 0, max: 30 }),
    fc.double({ min: 0, max: 300, noNaN: true }), (f, s, d, m) =>
      llegadaConHorasPico(s, m, f) <= llegadaConHorasPico(s + d, m, f)));
});
it("valida límites, finitud y traslapes sin mutar ni exigir orden", () => {
  for (const f of [
    [{ inicioMin: 10, finMin: 10, factor: 1 }], [{ inicioMin: -1, finMin: 10, factor: 1 }],
    [{ inicioMin: 0, finMin: 1440, factor: 1 }], [{ inicioMin: 0.5, finMin: 10, factor: 1 }],
    [{ inicioMin: 0, finMin: 10, factor: 0.9 }], [{ inicioMin: 0, finMin: 10, factor: 3.1 }],
    [{ inicioMin: 0, finMin: 10, factor: NaN }], [...pico, { inicioMin: 500, finMin: 600, factor: 1 }],
  ]) expect(validarFranjas(f)).not.toBeNull();
  expect(validarFranjas([])).toBeNull();
  expect(validarFranjas([{ inicioMin: 570, finMin: 600, factor: 3 }, ...pico])).toBeNull();
});
it("comparte coordenadas idénticas y distingue hasta el último decimal", () => {
  const e = entrada();
  const a = e.parametros.patio, b = { lat: a.lat + 0.0000001, lng: a.lng };
  e.traslados = { puntos: [a, b], km: [[0, 2], [3, 0]], minLibres: [[0, 7], [9, 0]],
    ajusteM: [0, 0], aproximados: [], mapa: "sintético" };
  const t = crearTraslados(e);
  expect(t.tramo(a, { ...a })).toEqual({ km: 0, minLibres: 0 });
  expect(t.tramo(a, b)).toEqual({ km: 2, minLibres: 7 });
  expect(t.tramo(b, a)).toEqual({ km: 3, minLibres: 9 });
  expect(() => t.tramo(a, { ...b, lat: b.lat + 0.0000001 })).toThrow("punto_faltante");
});
it("rechaza matrices inválidas y puntos necesarios ausentes aun sin rutas", () => {
  const e = entrada();
  e.traslados = { puntos: [e.parametros.patio], km: [[1]], minLibres: [[0]], ajusteM: [0], aproximados: [], mapa: "s" };
  expect(() => crearTraslados(e)).toThrow("matriz_invalida");
  e.traslados.km = [[0]];
  e.solicitudes[0].ubicacion = { lat: 1, lng: 2 };
  expect(() => crearTraslados(e)).toThrow("punto_faltante");
});
it("cruza varias franjas consecutivas y huecos sin redondeos intermedios", () => {
  const franjas = [{ inicioMin: 420, finMin: 430, factor: 2 }, { inicioMin: 430, finMin: 450, factor: 2 },
    { inicioMin: 460, finMin: 480, factor: 3 }];
  // De 410 a 420 consume 10; las dos franjas consumen 15; hueco 10; quedan 5 × 3.
  expect(llegadaConHorasPico(410, 40, franjas)).toBe(475);
});
