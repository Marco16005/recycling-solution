import { beforeEach, describe, expect, it } from "vitest";
import { distanciaKm, type Coordenada } from "@/motor";
import { matrizDeTraslados, UMBRAL_PIN_M } from "./index";
import { reiniciarCacheDeTrazos, trazosDeViajes } from "./trazos";

// Plan 7, P7-5, contra OSRM real con el mapa sintético de infra/mapa/prueba (compose.test.yaml):
// cuadrícula cada 0.005° entre 20.58–20.70 y −100.34–−100.22; fila 20.60 solo hacia el este; isla en 20.75–20.77.

const url = process.env.OSRM_URL;
const opciones = { url, factorCamion: 1, respaldo: { velocidadKmh: 30, factorCircuidad: 1.4 } };
const A: Coordenada = { lat: 20.62, lng: -100.3 };
const B: Coordenada = { lat: 20.63, lng: -100.29 };
const ISLA: Coordenada = { lat: 20.76, lng: -100.3 };
const SIN_CALLES: Coordenada = { lat: 20.725, lng: -100.28 };
const FUERA_DE_LA_CAJA: Coordenada = { lat: 19.43, lng: -99.13 };

describe("OSRM real con el mapa sintético", () => {
  beforeEach(() => reiniciarCacheDeTrazos());

  it("la distancia por calle entre dos cruces es la suma de los tramos de la cuadrícula (±2 %) y el mapa se identifica", async () => {
    const r = await matrizDeTraslados([A, B], opciones);
    expect(r.info).toEqual({ fuente: "osrm", motivo: null, mapa: "prueba-cuadricula", paresAproximados: 0 });
    const esperado = distanciaKm(A, { lat: B.lat, lng: A.lng }, 1) + distanciaKm({ lat: B.lat, lng: A.lng }, B, 1);
    expect(Math.abs(r.matriz!.km[0][1] - esperado) / esperado).toBeLessThan(0.02);
    expect(r.matriz!.minLibres[0][1]).toBeGreaterThan(0);
    expect(r.consultaMs).toBeGreaterThan(0);
  });

  it("respeta el sentido único: por la fila 20.60 hacia el este es más corto que de regreso", async () => {
    const oeste = { lat: 20.6, lng: -100.32 }, este = { lat: 20.6, lng: -100.3 };
    const m = (await matrizDeTraslados([oeste, este], opciones)).matriz!;
    expect(m.km[0][1]).toBeLessThan(m.km[1][0]);
  });

  it("la isla desconectada da pares aproximados con la fórmula y la mezcla queda contada", async () => {
    const r = await matrizDeTraslados([A, B, ISLA], opciones);
    expect(r.matriz!.aproximados).toEqual([[0, 2], [1, 2], [2, 0], [2, 1]]);
    expect(r.info.paresAproximados).toBe(4);
    expect(r.matriz!.km[0][2]).toBe(distanciaKm(A, ISLA, 1.4));
  });

  it("un pin lejos de toda calle y uno fuera de la caja del mapa quedan con su distancia de ajuste, sin fallar", async () => {
    const r = await matrizDeTraslados([A, SIN_CALLES, FUERA_DE_LA_CAJA], opciones);
    expect(r.info.fuente).toBe("osrm");
    expect(r.matriz!.ajusteM[0]).toBeLessThan(UMBRAL_PIN_M);
    expect(r.matriz!.ajusteM[1]).toBeGreaterThan(UMBRAL_PIN_M);
    expect(r.matriz!.ajusteM[2]).toBeGreaterThan(100_000);
  });

  it("un solo punto (plan sin solicitudes) da una matriz de 1 × 1", async () => {
    const r = await matrizDeTraslados([A], opciones);
    expect(r.matriz!.km).toEqual([[0]]);
    expect(r.info.fuente).toBe("osrm");
  });

  it("un servicio inexistente da sin_respuesta", async () => {
    const r = await matrizDeTraslados([A, B], { ...opciones, url: "http://127.0.0.1:9", plazoMs: 2000 });
    expect(r.info.motivo).toBe("sin_respuesta");
  });

  it("el trazo de un viaje redondo sigue las calles, empieza y termina en el patio, y lleva su mapa", async () => {
    const [trazo] = await trazosDeViajes([[A, B, A]], { url });
    expect(trazo.recto).toBe(false);
    expect(trazo.mapa).toBe("prueba-cuadricula");
    expect(trazo.coordenadas.length).toBeGreaterThan(3);
    for (const extremo of [trazo.coordenadas[0], trazo.coordenadas.at(-1)!]) {
      expect(Math.abs(extremo[0] - A.lng)).toBeLessThan(0.001);
      expect(Math.abs(extremo[1] - A.lat)).toBeLessThan(0.001);
    }
  });
});
