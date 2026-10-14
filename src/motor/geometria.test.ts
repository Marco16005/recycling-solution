import { describe, expect, it } from "vitest";
import { distanciaKm, minutosDeTraslado } from "./index";
import { agruparZonas, crearAleatorio } from "./zonas";

describe("Geometría y zonas", () => {
  it("haversine conocido, simetría, circuidad y antípodas", () => {
    const a = { lat: 0, lng: 0 };
    const b = { lat: 0, lng: 1 };
    expect(distanciaKm(a, a, 1.3)).toBe(0);
    expect(distanciaKm(a, b, 1)).toBeCloseTo(111.19508, 4);
    expect(distanciaKm(a, b, 1.3)).toBe(distanciaKm(b, a, 1.3));
    expect(distanciaKm(a, b, 1.3)).toBeCloseTo(111.19508 * 1.3, 4);
    expect(distanciaKm(a, { lat: 0, lng: 180 }, 1)).toBeCloseTo(Math.PI * 6371.0088);
    expect(minutosDeTraslado(0, 30)).toBe(0);
    expect(minutosDeTraslado(1.01, 30)).toBe(3);
  });
  it("azar reproducible, acotado y sensible a la semilla", () => {
    const muestra = (semilla: number) => { const azar = crearAleatorio(semilla); return Array.from({ length: 100 }, () => azar()); };
    expect(muestra(0)).toEqual(muestra(0));
    expect(muestra(0)).not.toEqual(muestra(1));
    expect(muestra(0).every(n => n >= 0 && n < 1)).toBe(true);
  });
  it("resuelve cero puntos, k mayor que n y zonas idénticas vacías", () => {
    const p = { lat: 20, lng: -100 };
    expect(agruparZonas([], 5, p, 1)).toEqual([]);
    expect(agruparZonas([p], 0, p, 1)).toEqual([]);
    const puntos = Array.from({ length: 10 }, () => p);
    const zonas = agruparZonas(puntos, 5, p, 0);
    expect(new Set(zonas).size).toBe(5);
    expect(zonas).toEqual(agruparZonas(puntos, 5, p, 0));
    expect(agruparZonas([p, p], 5, p, 0).sort()).toEqual([0, 1]);
  });
  it("agrupa puntos separados sin depender de distancias nulas", () => {
    const p = { lat: 0, lng: 0 };
    const zonas = agruparZonas([p, p, { lat: 10, lng: 10 }, { lat: 10, lng: 10 }], 2, p, 4);
    expect(zonas[0]).toBe(zonas[1]);
    expect(zonas[2]).toBe(zonas[3]);
    expect(zonas[0]).not.toBe(zonas[2]);
  });
});
