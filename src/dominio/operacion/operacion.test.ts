import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createHash } from "node:crypto";
import { aplicarEvento, fronteraDeReruteo, huellaEvento } from "./index";
import type { EstadoJornada, EventoEntrada, TipoEvento } from "./tipos";

const hora = (min = 480) => new Date(Date.parse("2026-10-15T00:00:00-06:00") + min * 60_000).toISOString();
function estado(): EstadoJornada {
  return { jornadaId: "j", fecha: "2026-10-15", checkInEn: null, checkOutEn: null, ultimoOcurridoEn: null,
    ultimoOdometroKm: null, viajes: [0, 1].map(i => ({ rutaId: `r${i}`, version: 1,
      salidaEstimada: hora(480 + i * 120), regresoEstimado: hora(560 + i * 120), finDescargaEstimado: hora(580 + i * 120),
      salidaPatioEn: null, regresoPatioEn: null, descargaFinEn: null, odometroInicioKm: null,
      paradas: [0, 1].map(k => ({ paradaId: `p${i}${k}`, solicitudId: `s${i}${k}`, secuencia: k + 1,
        estado: "pendiente", vigente: true, llegadaEstimada: hora(490 + i * 120 + k * 30),
        inicioEstimado: hora(495 + i * 120 + k * 30), finEstimado: hora(510 + i * 120 + k * 30),
        llegadaEn: null, inicioServicioEn: null, cierreEn: null, ventanaInicio: "08:00", ventanaFin: "16:00" })),
      tiempos: null })) };
}
function evento(tipo: TipoEvento, cambios: Partial<EventoEntrada> = {}): EventoEntrada {
  const jornada = tipo === "check_in" || tipo === "check_out";
  return { eventoId: "e", jornadaId: "j", tipo, ocurridoEn: hora(), rutaId: jornada ? null : "r0",
    versionRuta: jornada ? null : 1, paradaId: ["llegada", "inicio_servicio", "fin_servicio", "no_atendida"].includes(tipo) ? "p00" : null,
    odometroKm: 100, motivo: "Cliente cerrado", ...cambios };
}
/** Intérprete de los efectos públicos: la máquina nunca modifica por sí misma el estado. */
function avanzar(s: EstadoJornada, e: EventoEntrada) {
  const copia = structuredClone(s);
  const resultado = aplicarEvento(s, e, e.ocurridoEn);
  expect(s).toEqual(copia);
  if (!resultado.ok) return false;
  for (const efecto of resultado.efectos) {
    if (efecto.tipo === "jornada") {
      if (efecto.campo === "check_in_en") s.checkInEn = e.ocurridoEn;
      else s.checkOutEn = e.ocurridoEn;
    } else if (efecto.tipo === "ruta") {
      const v = s.viajes.find(v => v.rutaId === efecto.rutaId)!;
      if (efecto.campo === "salida_patio_en") { v.salidaPatioEn = e.ocurridoEn; v.odometroInicioKm = efecto.odometroKm!; }
      if (efecto.campo === "regreso_patio_en") v.regresoPatioEn = e.ocurridoEn;
      if (efecto.campo === "descarga_fin_en") v.descargaFinEn = e.ocurridoEn;
      if (efecto.odometroKm !== undefined) s.ultimoOdometroKm = efecto.odometroKm;
    } else if (efecto.tipo === "parada") {
      const p = s.viajes.flatMap(v => v.paradas).find(p => p.paradaId === efecto.paradaId)!;
      p.estado = efecto.estado;
      if (efecto.liberar) p.vigente = false;
      if (efecto.campos.includes("llegada_en")) p.llegadaEn = e.ocurridoEn;
      if (efecto.campos.includes("inicio_servicio_en")) p.inicioServicioEn = e.ocurridoEn;
      if (efecto.campos.includes("cierre_en")) p.cierreEn = e.ocurridoEn;
    }
  }
  s.ultimoOcurridoEn = e.ocurridoEn;
  return true;
}
const tipos: TipoEvento[] = ["check_in", "salida_patio", "llegada", "inicio_servicio", "fin_servicio", "no_atendida", "regreso_patio", "fin_descarga", "check_out"];

describe("máquina de operación", () => {
  it("ninguna secuencia aceptada rompe exclusión, llegada, odómetro o cierre", () => {
    fc.assert(fc.property(fc.array(fc.record({ tipo: fc.constantFrom(...tipos), viaje: fc.integer({ min: 0, max: 1 }),
      parada: fc.integer({ min: 0, max: 1 }), km: fc.integer({ min: 0, max: 300 }) }), { maxLength: 200 }), pasos => {
      const s = estado();
      for (const [i, paso] of pasos.entries()) {
        const e = evento(paso.tipo, { ocurridoEn: hora(480 + i), odometroKm: paso.km });
        if (e.rutaId) { e.rutaId = `r${paso.viaje}`; if (e.paradaId) e.paradaId = `p${paso.viaje}${paso.parada}`; }
        const cerrado = s.checkOutEn, km = s.ultimoOdometroKm;
        const aceptado = avanzar(s, e);
        if (cerrado) expect(aceptado).toBe(false);
        expect(s.ultimoOdometroKm ?? 0).toBeGreaterThanOrEqual(km ?? 0);
        const paradas = s.viajes.flatMap(v => v.paradas);
        expect(paradas.filter(p => ["en_sitio", "en_servicio"].includes(p.estado)).length).toBeLessThanOrEqual(1);
        for (const p of paradas.filter(p => p.estado === "completada")) expect(p.llegadaEn).not.toBeNull();
      }
    }), { numRuns: 300 });
  });

  it("recorre jornadas completas con cierres variables y rechaza todo después", () => {
    fc.assert(fc.property(fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }), fc.nat(10000), (omitidas, km) => {
      const s = estado(); let minuto = 480;
      const enviar = (tipo: TipoEvento, cambios: Partial<EventoEntrada> = {}) => {
        expect(avanzar(s, evento(tipo, { ocurridoEn: hora(minuto++), odometroKm: km + minuto, ...cambios }))).toBe(true);
      };
      enviar("check_in");
      for (let v = 0; v < 2; v++) {
        enviar("salida_patio", { rutaId: `r${v}` });
        for (let p = 0; p < 2; p++) {
          const ids = { rutaId: `r${v}`, paradaId: `p${v}${p}` };
          if (omitidas[v * 2 + p]) enviar("no_atendida", ids);
          else { enviar("llegada", ids); enviar("inicio_servicio", ids); enviar("fin_servicio", ids); }
        }
        enviar("regreso_patio", { rutaId: `r${v}` });
        enviar("fin_descarga", { rutaId: `r${v}` });
      }
      enviar("check_out");
      for (const tipo of tipos) expect(aplicarEvento(s, evento(tipo), hora()).ok).toBe(false);
    }));
  });

  const rechazos: [string, TipoEvento, (s: EstadoJornada, e: EventoEntrada) => void, string?][] = [
    ["jornada", "check_in", (_, e) => { e.jornadaId = "otra"; }],
    ["cerrada", "check_in", s => { s.checkOutEn = hora(); }],
    ["hora inválida", "check_in", (_, e) => { e.ocurridoEn = "mal"; }],
    ["fecha México", "check_in", (_, e) => { e.ocurridoEn = "2026-10-15T05:59:59Z"; }],
    ["anterior", "check_in", s => { s.ultimoOcurridoEn = hora(481); }],
    ["futuro", "check_in", (_, e) => { e.ocurridoEn = hora(483); }],
    ["24 horas", "check_in", () => {}, hora(1921)],
    ["referencias jornada", "check_in", (_, e) => { e.rutaId = "r0"; }],
    ["check in repetido", "check_in", s => { s.checkInEn = hora(); }],
    ["sin check in", "salida_patio", s => { s.checkInEn = null; }],
    ["check out pendiente", "check_out", () => {}],
    ["versión", "salida_patio", (_, e) => { e.versionRuta = 0; }],
    ["ruta desconocida", "salida_patio", (_, e) => { e.rutaId = "otra"; }],
    ["referencia parada", "salida_patio", (_, e) => { e.paradaId = "p00"; }],
    ["salida repetida", "salida_patio", s => { s.viajes[0].salidaPatioEn = hora(); }],
    ["viaje anterior", "salida_patio", (_, e) => { e.rutaId = "r1"; }],
    ["sin vigentes", "salida_patio", s => { s.viajes[0].paradas.forEach(p => { p.vigente = false; }); }],
    ["odómetro salida", "salida_patio", (_, e) => { e.odometroKm = -1; }],
    ["regreso sin salida", "regreso_patio", () => {}],
    ["regreso repetido", "regreso_patio", s => { s.viajes[0].salidaPatioEn = hora(); s.viajes[0].regresoPatioEn = hora(); }],
    ["regreso con pendientes", "regreso_patio", s => { s.viajes[0].salidaPatioEn = hora(); }],
    ["odómetro regreso", "regreso_patio", s => { s.viajes[0].salidaPatioEn = hora(); s.viajes[0].odometroInicioKm = 200; s.viajes[0].paradas.forEach(p => { p.estado = "omitida"; }); }],
    ["descarga sin regreso", "fin_descarga", () => {}],
    ["descarga repetida", "fin_descarga", s => { s.viajes[0].regresoPatioEn = hora(); s.viajes[0].descargaFinEn = hora(); }],
    ["parada retirada", "llegada", s => { s.viajes[0].paradas[0].vigente = false; }],
    ["parada desconocida", "llegada", (_, e) => { e.paradaId = "otra"; }],
    ["llegada antes de salir", "llegada", () => {}],
    ["llegada fuera de secuencia", "llegada", (s, e) => { s.viajes[0].salidaPatioEn = hora(); e.paradaId = "p01"; }],
    ["otra en sitio", "llegada", (s, e) => { s.viajes[0].salidaPatioEn = hora(); s.viajes[0].paradas[0].estado = "en_sitio"; e.paradaId = "p01"; }],
    ["inicio sin llegada", "inicio_servicio", s => { s.viajes[0].salidaPatioEn = hora(); }],
    ["fin sin inicio", "fin_servicio", s => { s.viajes[0].salidaPatioEn = hora(); }],
    ["no atendida sin motivo", "no_atendida", (s, e) => { s.viajes[0].salidaPatioEn = hora(); e.motivo = " "; }],
    ["no atendida en servicio", "no_atendida", s => { s.viajes[0].salidaPatioEn = hora(); s.viajes[0].paradas[0].estado = "en_servicio"; }],
    ["no atendida fuera de orden", "no_atendida", (s, e) => { s.viajes[0].salidaPatioEn = hora(); e.paradaId = "p01"; }],
    ["tipo desconocido", "salida_patio", (_, e) => { e.tipo = "otro" as TipoEvento; }],
  ];
  it.each(rechazos)("rechaza %s", (_, tipo, modificar, recibido) => {
    const s = estado(), e = evento(tipo);
    if (tipo !== "check_in") s.checkInEn = hora();
    modificar(s, e);
    expect(aplicarEvento(s, e, recibido ?? hora())).toMatchObject({ ok: false, motivo: expect.any(String) });
  });
  it("acepta límites exactos de hora, empate y recepción al día siguiente", () => {
    expect(aplicarEvento(estado(), evento("check_in"), hora(478)).ok).toBe(true);
    expect(aplicarEvento(estado(), evento("check_in"), hora(1920)).ok).toBe(true);
    const s = estado(); s.ultimoOcurridoEn = hora();
    expect(aplicarEvento(s, evento("check_in"), hora()).ok).toBe(true);
  });
  it("no atendida en sitio libera sin inventar horas de servicio", () => {
    const s = estado(); s.checkInEn = hora(); s.viajes[0].salidaPatioEn = hora(); s.viajes[0].paradas[0].estado = "en_sitio";
    expect(aplicarEvento(s, evento("no_atendida"), hora())).toEqual({ ok: true, efectos: [
      { tipo: "parada", paradaId: "p00", estado: "no_atendida", campos: ["cierre_en"], motivo: "Cliente cerrado", liberar: true },
      { tipo: "solicitud", paradaId: "p00", estado: "pendiente_siguiente_dia" },
    ] });
  });
  it("disponibilidad apunta a la ruta siguiente", () => {
    const s = estado(); s.checkInEn = hora(); s.viajes[0].regresoPatioEn = hora();
    expect(aplicarEvento(s, evento("fin_descarga"), hora())).toEqual({ ok: true, efectos: [
      { tipo: "ruta", rutaId: "r0", campo: "descarga_fin_en" }, { tipo: "disponibilidad_siguiente", rutaId: "r1" },
    ] });
  });
});

describe("huella", () => {
  it("SHA-256 canónico, UTF-8, independiente del orden de claves", () => {
    fc.assert(fc.property(fc.string(), motivo => {
      const e = evento("no_atendida", { motivo });
      const inverso = Object.fromEntries(Object.entries(e).reverse()) as unknown as EventoEntrada;
      const canonico = JSON.stringify(Object.fromEntries(Object.entries(e).sort(([a], [b]) => a.localeCompare(b))));
      expect(huellaEvento(e)).toBe(createHash("sha256").update(canonico).digest("hex"));
      expect(huellaEvento(e)).toBe(huellaEvento(inverso));
      expect(huellaEvento({ ...e, jornadaId: "otra" })).not.toBe(huellaEvento(e));
    }));
  });
});

describe("frontera", () => {
  it("congela el viaje completo, conserva futuros y traslada pendientes al retirar unidad", () => {
    const s = estado(); s.viajes[0].salidaPatioEn = hora(490);
    expect(fronteraDeReruteo(s, true, hora(500))).toEqual({ ok: true, congeladas: ["s00", "s01"],
      viajeEnCurso: "r0", retrasoMin: 10, libreDesdeMin: 590, admitidas: [["s10", "s11"]], aReubicar: [], liberadas: [] });
    expect(fronteraDeReruteo(s, false, hora(500))).toMatchObject({ ok: true, congeladas: [], admitidas: [], aReubicar: ["s00", "s01", "s10", "s11"] });
  });
  it.each(["en_sitio", "en_servicio"] as const)("impide retirar una jornada %s", estadoParada => {
    const s = estado(); s.viajes[0].paradas[0].estado = estadoParada;
    expect(fronteraDeReruteo(s, false, hora()).ok).toBe(false);
  });
  it("último hito, no mayor retraso; no atendida usa llegada estimada", () => {
    const s = estado(), v = s.viajes[0]; v.salidaPatioEn = hora(500);
    v.paradas[0].estado = "no_atendida"; v.paradas[0].vigente = false; v.paradas[0].cierreEn = hora(505);
    expect(fronteraDeReruteo(s, true, hora(510))).toMatchObject({ retrasoMin: 15, libreDesdeMin: 595 });
    v.regresoPatioEn = hora(555);
    expect(fronteraDeReruteo(s, true, hora(600))).toMatchObject({ retrasoMin: 0, libreDesdeMin: 600 });
    v.descargaFinEn = hora(580); v.paradas[1].estado = "omitida"; v.paradas[1].vigente = false;
    expect(fronteraDeReruteo(s, true, hora(600))).toMatchObject({ congeladas: ["s00"], viajeEnCurso: null, libreDesdeMin: 600 });
  });
  it.each([
    ["llegada", 502, 12], ["inicio", 502, 7], ["cierre", 522, 12],
  ] as const)("calcula el retraso del último hito: %s", (hito, minuto, retraso) => {
    const s = estado(), v = s.viajes[0], p = v.paradas[0]; v.salidaPatioEn = hora(480);
    if (hito === "llegada") p.llegadaEn = hora(minuto);
    if (hito === "inicio") { p.llegadaEn = hora(500); p.inicioServicioEn = hora(minuto); }
    if (hito === "cierre") { p.estado = "completada"; p.cierreEn = hora(minuto); }
    expect(fronteraDeReruteo(s, true, hora(530))).toMatchObject({ retrasoMin: retraso, libreDesdeMin: 580 + retraso });
  });
  it("redondea disponibilidad hacia arriba y conserva minutos del día siguiente", () => {
    const s = estado(), v = s.viajes[0];
    v.salidaPatioEn = hora(480.5); v.finDescargaEstimado = hora(1440);
    expect(fronteraDeReruteo(s, true, hora(500))).toMatchObject({ retrasoMin: 0.5, libreDesdeMin: 1441 });
  });
  it("sin viaje iniciado admite futuros; rechaza ahora inválido", () => {
    expect(fronteraDeReruteo(estado(), true, hora())).toMatchObject({ admitidas: [["s00", "s01"], ["s10", "s11"]], libreDesdeMin: 480 });
    expect(fronteraDeReruteo(estado(), true, "mal").ok).toBe(false);
  });
});
