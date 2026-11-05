import { beforeEach, describe, expect, it } from "vitest";
import { distanciaKm, type Coordenada, type EntradaPlan } from "@/motor";
import { conTraslados, LIMITE_PUNTOS, matrizDeTraslados, puntosDeEntrada, type OpcionesOsrm } from "./index";
import { sinBarrasFinales } from "./osrm";
import { reiniciarCacheDeTrazos, trazosDeViajes } from "./trazos";

// Plan 7, P7-5. Las respuestas imitan las de OSRM 26 (/table y /route); la integración prueba contra OSRM real.

const A: Coordenada = { lat: 20.62, lng: -100.3 };
const B: Coordenada = { lat: 20.63, lng: -100.29 };
const C: Coordenada = { lat: 20.76, lng: -100.3 };
const respaldo = { velocidadKmh: 30, factorCircuidad: 1.4 };

function responder(cuerpo: unknown, estado = 200): typeof fetch {
  return (async () => new Response(typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo), { status: estado })) as typeof fetch;
}
const opciones = (f: typeof fetch, cambios: Partial<OpcionesOsrm> = {}): OpcionesOsrm =>
  ({ url: "http://osrm:5000", factorCamion: 1.2, respaldo, fetch: f, ...cambios });

const tablaOk = {
  code: "Ok", data_version: "prueba-cuadricula",
  distances: [[0, 2149.4, null], [2149.4, 0, null], [null, null, 0]],
  durations: [[0, 311.5, null], [311.5, 0, null], [null, null, 0]],
  sources: [{ distance: 0 }, { distance: 12.5 }, { distance: 2768 }],
  destinations: [{ distance: 0 }, { distance: 12.5 }, { distance: 2768 }],
};

describe("matrizDeTraslados", () => {
  it("sin URL no consulta y responde aproximado sin_configurar", async () => {
    let llamadas = 0;
    const r = await matrizDeTraslados([A, B], opciones((async () => { llamadas++; return new Response("{}"); }) as typeof fetch, { url: "" }));
    expect(r).toEqual({ matriz: null, info: { fuente: "aproximado", motivo: "sin_configurar", mapa: null, paresAproximados: 0 }, consultaMs: null });
    expect(llamadas).toBe(0);
  });

  it(`más de ${LIMITE_PUNTOS} puntos no consulta y responde demasiados_puntos`, async () => {
    let llamadas = 0;
    const puntos = Array.from({ length: LIMITE_PUNTOS + 1 }, (_, i) => ({ lat: 20 + i / 1e4, lng: -100 }));
    const r = await matrizDeTraslados(puntos, opciones((async () => { llamadas++; return new Response("{}"); }) as typeof fetch));
    expect(r.info).toEqual({ fuente: "aproximado", motivo: "demasiados_puntos", mapa: null, paresAproximados: 0 });
    expect(r.consultaMs).toBeNull();
    expect(llamadas).toBe(0);
  });

  it("OSRM que no responde a tiempo da sin_respuesta dentro del plazo y mide la consulta", async () => {
    const colgado = ((_: unknown, init?: RequestInit) => new Promise<Response>((_r, rechazar) => {
      init?.signal?.addEventListener("abort", () => rechazar(new DOMException("abortado", "AbortError")));
    })) as typeof fetch;
    const inicio = performance.now();
    const r = await matrizDeTraslados([A, B], opciones(colgado, { plazoMs: 50 }));
    expect(performance.now() - inicio).toBeLessThan(1000);
    expect(r.matriz).toBeNull();
    expect(r.info.motivo).toBe("sin_respuesta");
    expect(r.consultaMs).toBeGreaterThanOrEqual(40);
  });

  it("una red caída también es sin_respuesta", async () => {
    const r = await matrizDeTraslados([A, B], opciones((async () => { throw new TypeError("fetch failed"); }) as typeof fetch));
    expect(r.info.motivo).toBe("sin_respuesta");
  });

  it.each([
    ["no es JSON", "<html>502</html>", 502],
    ["sin durations", { code: "Ok", distances: [[0, 1], [1, 0]], sources: [{ distance: 0 }, { distance: 0 }] }, 200],
    ["matriz del tamaño equivocado", { ...tablaOk, distances: [[0]], durations: [[0]], sources: [{ distance: 0 }] }, 200],
    ["un valor que no es número", { ...tablaOk, distances: [[0, "x"], [1, 0]], durations: [[0, 1], [1, 0]], sources: [{ distance: 0 }, { distance: 0 }] }, 200],
  ])("respuesta con forma inesperada (%s) da respuesta_invalida", async (_n, cuerpo, estado) => {
    const puntos = (cuerpo as { sources?: unknown[] }).sources?.length === 3 ? [A, B, C] : [A, B];
    const r = await matrizDeTraslados(puntos, opciones(responder(cuerpo, estado)));
    expect(r.matriz).toBeNull();
    expect(r.info.motivo).toBe("respuesta_invalida");
  });

  it("un código de OSRM distinto de Ok (NoSegment) da error_osrm", async () => {
    const r = await matrizDeTraslados([A, B], opciones(responder({ code: "NoSegment", message: "Could not find a matching segment" }, 400)));
    expect(r.info).toEqual({ fuente: "aproximado", motivo: "error_osrm", mapa: null, paresAproximados: 0 });
  });

  it("convierte metros y segundos, aplica el factor de camión, guarda el ajuste y el mapa", async () => {
    const r = await matrizDeTraslados([A, B, C], opciones(responder(tablaOk)));
    expect(r.info).toEqual({ fuente: "osrm", motivo: null, mapa: "prueba-cuadricula", paresAproximados: 4 });
    const m = r.matriz!;
    expect(m.puntos).toEqual([A, B, C]);
    expect(m.km[0][1]).toBeCloseTo(2.1494, 10);
    expect(m.minLibres[0][1]).toBeCloseTo((311.5 / 60) * 1.2, 10);
    expect(m.ajusteM).toEqual([0, 12.5, 2768]);
    expect(m.mapa).toBe("prueba-cuadricula");
    expect(m.km[0][0]).toBe(0);
    expect(m.minLibres[2][2]).toBe(0);
  });

  it("una celda sin ruta se llena con la fórmula anterior (sin factor de camión) y queda en aproximados", async () => {
    const m = (await matrizDeTraslados([A, B, C], opciones(responder(tablaOk)))).matriz!;
    const km = distanciaKm(A, C, respaldo.factorCircuidad);
    expect(m.km[0][2]).toBe(km);
    expect(m.minLibres[0][2]).toBe((km * 60) / respaldo.velocidadKmh);
    expect(m.aproximados).toEqual([[0, 2], [1, 2], [2, 0], [2, 1]]);
  });

  it("pide las coordenadas como lng,lat en el orden dado, con distancia y duración", async () => {
    let pedida = "";
    const espia = (async (url: string | URL | Request) => { pedida = String(url); return new Response(JSON.stringify(tablaOk)); }) as typeof fetch;
    await matrizDeTraslados([A, B, C], opciones(espia));
    expect(pedida).toBe("http://osrm:5000/table/v1/driving/-100.3,20.62;-100.29,20.63;-100.3,20.76?annotations=distance,duration");
  });
});

it("un solo punto pide /nearest (OSRM exige dos para /table) y arma la matriz de 1 × 1 con su ajuste", async () => {
  let pedida = "";
  const espia = (async (url: string | URL | Request) => {
    pedida = String(url);
    return new Response(JSON.stringify({ code: "Ok", data_version: "m", waypoints: [{ distance: 7.5, location: [-100.3, 20.62] }] }));
  }) as typeof fetch;
  const r = await matrizDeTraslados([A], opciones(espia));
  expect(pedida).toBe("http://osrm:5000/nearest/v1/driving/-100.3,20.62");
  expect(r.matriz).toMatchObject({ km: [[0]], minLibres: [[0]], ajusteM: [7.5], aproximados: [], mapa: "m" });
});

describe("puntosDeEntrada y conTraslados", () => {
  const entrada = {
    fecha: "2026-10-15", instanteMin: 480,
    parametros: { patio: A },
    solicitudes: [{ ubicacion: B }, { ubicacion: { lat: 20.6200001, lng: -100.3 } }, { ubicacion: { ...B } }, { ubicacion: { lat: 20.6200004, lng: -100.3 } }],
    unidades: [{ ubicacionInicial: { ...A } }, { ubicacionInicial: C }],
  } as unknown as EntradaPlan;

  it("patio, solicitudes y unidades sin repetir por identidad exacta, en ese orden", () => {
    expect(puntosDeEntrada(entrada)).toEqual([A, B, { lat: 20.6200001, lng: -100.3 }, { lat: 20.6200004, lng: -100.3 }, C]);
  });

  it("conTraslados agrega la matriz solo si la hay", async () => {
    const r = await matrizDeTraslados([A, B, C], opciones(responder(tablaOk)));
    expect(conTraslados(entrada, r).traslados).toBe(r.matriz);
    expect(conTraslados(entrada, { matriz: null, info: r.info, consultaMs: 1 })).toBe(entrada);
  });
});

describe("trazosDeViajes", () => {
  beforeEach(() => reiniciarCacheDeTrazos());
  const ruta = (version: string, coords: [number, number][]) => ({ code: "Ok", data_version: version, routes: [{ geometry: { type: "LineString", coordinates: coords } }] });
  const sonda = (version: string) => ({ code: "Ok", data_version: version, waypoints: [{ location: [-100.3, 20.62] }] });

  function servidor(version: () => string, contador: { rutas: number }) {
    return (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/nearest/")) return new Response(JSON.stringify(sonda(version())));
      contador.rutas++;
      return new Response(JSON.stringify(ruta(version(), [[-100.3, 20.62], [-100.295, 20.62], [-100.29, 20.63]])));
    }) as typeof fetch;
  }

  it("sin URL dibuja en línea recta, con [lng, lat]", async () => {
    expect(await trazosDeViajes([[A, B, A]], { url: undefined })).toEqual([{ coordenadas: [[-100.3, 20.62], [-100.29, 20.63], [-100.3, 20.62]], mapa: null, recto: true }]);
  });

  it("dibuja por calle con el mapa de la respuesta y la segunda vez sale de la caché", async () => {
    const contador = { rutas: 0 };
    const f = servidor(() => "mapa-1", contador);
    const primero = await trazosDeViajes([[A, B, A]], { url: "http://osrm:5000", fetch: f, reloj: () => 0 });
    expect(primero).toEqual([{ coordenadas: [[-100.3, 20.62], [-100.295, 20.62], [-100.29, 20.63]], mapa: "mapa-1", recto: false }]);
    await trazosDeViajes([[A, B, A]], { url: "http://osrm:5000", fetch: f, reloj: () => 1000 });
    expect(contador.rutas).toBe(1);
  });

  it("si el mapa cambia, pasada la vigencia de 60 s ya no devuelve el trazo viejo", async () => {
    const contador = { rutas: 0 };
    let version = "mapa-1";
    const f = servidor(() => version, contador);
    await trazosDeViajes([[A, B, A]], { url: "http://osrm:5000", fetch: f, reloj: () => 0 });
    version = "mapa-2";
    expect((await trazosDeViajes([[A, B, A]], { url: "http://osrm:5000", fetch: f, reloj: () => 30_000 }))[0].mapa).toBe("mapa-1");
    expect((await trazosDeViajes([[A, B, A]], { url: "http://osrm:5000", fetch: f, reloj: () => 61_000 }))[0].mapa).toBe("mapa-2");
    expect(contador.rutas).toBe(2);
  });

  it("si OSRM no responde, todo sale recto dentro del tiempo total y sin usar la caché", async () => {
    const colgado = ((_: unknown, init?: RequestInit) => new Promise<Response>((_r, rechazar) => {
      init?.signal?.addEventListener("abort", () => rechazar(new DOMException("abortado", "AbortError")));
    })) as typeof fetch;
    const inicio = performance.now();
    const r = await trazosDeViajes([[A, B, A], [A, C, A]], { url: "http://osrm:5000", fetch: colgado, plazoMs: 50, totalMs: 120, reloj: () => 0 });
    expect(performance.now() - inicio).toBeLessThan(1000);
    expect(r.every((t) => t.recto && t.mapa === null)).toBe(true);
  });

  it("una ruta fallida sale recta y las demás por calle", async () => {
    const f = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/nearest/")) return new Response(JSON.stringify(sonda("mapa-1")));
      if (u.includes("-100.3,20.76")) return new Response(JSON.stringify({ code: "NoRoute" }), { status: 400 });
      return new Response(JSON.stringify(ruta("mapa-1", [[-100.3, 20.62], [-100.29, 20.63]])));
    }) as typeof fetch;
    const r = await trazosDeViajes([[A, B, A], [A, C, A]], { url: "http://osrm:5000", fetch: f, reloj: () => 0 });
    expect(r.map((t) => t.recto)).toEqual([false, true]);
  });
});

describe("sinBarrasFinales (Plan de seguridad, SonarQube S8786)", () => {
  it("quita solo las barras finales, en tiempo lineal", () => {
    expect(sinBarrasFinales("http://osrm:5000///")).toBe("http://osrm:5000");
    expect(sinBarrasFinales("http://osrm:5000")).toBe("http://osrm:5000");
    expect(sinBarrasFinales("////")).toBe("");
    const larga = `http://${"/".repeat(100_000)}x`;
    const inicio = performance.now();
    expect(sinBarrasFinales(larga)).toBe(larga);
    expect(performance.now() - inicio).toBeLessThan(100);
  });
});
