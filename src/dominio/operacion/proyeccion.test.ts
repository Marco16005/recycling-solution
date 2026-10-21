import { expect, it } from "vitest";
import fc from "fast-check";
import { fronteraDeReruteo, proyectarJornada } from "./index";
import type { EstadoJornada } from "./tipos";
const hora = (m: number) => new Date(Date.parse("2026-10-15T00:00:00-06:00") + m * 60000).toISOString();
function estado(): EstadoJornada {
  return { jornadaId: "j", fecha: "2026-10-15", checkInEn: hora(470), checkOutEn: null,
    ultimoOcurridoEn: null, ultimoOdometroKm: null, viajes: [{ rutaId: "r", version: 1,
      salidaEstimada: hora(480), regresoEstimado: hora(585), finDescargaEstimado: hora(605),
      salidaPatioEn: hora(490), regresoPatioEn: null, descargaFinEn: null, odometroInicioKm: null,
      tiempos: { puntos: ["patio", "A", "B"], minLibres: [[0, 20, 30], [22, 0, 15], [25, 15, 0]],
        horasPico: [], turnoFinMin: 960, descargaMin: 20 },
      paradas: ["A", "B"].map((id, i) => ({ paradaId: id, solicitudId: id, secuencia: i + 1,
        estado: "pendiente", vigente: true, llegadaEstimada: hora(i ? 535 : 500),
        inicioEstimado: hora(i ? 540 : 500), finEstimado: hora(i ? 560 : 520),
        llegadaEn: null, inicioServicioEn: null, cierreEn: null,
        ventanaInicio: i ? "09:00" : "08:00", ventanaFin: i ? "10:00" : "09:00" })) }] };
}
const opciones = (m: number) => ({ ahora: hora(m), umbralAtrasoMin: 15, turnoFinMin: 960, descargaMin: 20 });
const proyectar = (s: EstadoJornada, m: number) => proyectarJornada(s, opciones(m));
it("el reloj manda: 08:40 → A 08:40, B 09:15, atraso 20 en ambas", () => {
  const p = proyectar(estado(), 520);
  expect(p.viajes[0].paradas.map(p => p.llegada)).toEqual([hora(520), hora(555)]);
  expect(p.alertas.map(a => [a.tipo, a.paradaId, a.minutos])).toEqual([["atraso", "A", 20], ["atraso", "B", 20]]);
});
it("09:30: riesgo 30 en A y 5 en B", () => {
  expect(proyectar(estado(), 570).alertas.filter(a => a.tipo === "ventana_en_riesgo").map(a => a.minutos)).toEqual([30, 5]);
});
it("servicio iniciado 08:20, son 08:50: conserva inicio, fin 08:50 y B 09:05", () => {
  const s = estado(), a = s.viajes[0].paradas[0];
  a.estado = "en_servicio"; a.llegadaEn = hora(499); a.inicioServicioEn = hora(500);
  const p = proyectar(s, 530).viajes[0].paradas;
  expect(p[0]).toMatchObject({ llegada: a.llegadaEn, inicio: a.inicioServicioEn, fin: hora(530) });
  expect(p[1].llegada).toBe(hora(545));
});
it("en sitio a 09:10 inicia ahora y arriesga 10 minutos", () => {
  const s = estado(); Object.assign(s.viajes[0].paradas[0], { estado: "en_sitio", llegadaEn: hora(500) });
  expect(proyectar(s, 550).viajes[0].paradas[0].inicio).toBe(hora(550));
  expect(proyectar(s, 550).alertas).toContainEqual({ tipo: "ventana_en_riesgo", rutaId: "r", paradaId: "A", minutos: 10, enViajeEnCurso: true });
});
it.each(["omitida", "reasignada"] as const)("%s no se visita: patio → B 08:30", estadoParada => {
  const s = estado(); s.viajes[0].salidaPatioEn = hora(480);
  Object.assign(s.viajes[0].paradas[0], { estado: estadoParada, vigente: false });
  expect(proyectar(s, 480).viajes[0].paradas).toEqual([
    { paradaId: "B", llegada: hora(510), inicio: hora(540), fin: hora(560), ubicacionSupuesta: false }]);
});
it("no atendida sin llegada: patio supuesto desde 08:30 → B 09:00", () => {
  const s = estado(); Object.assign(s.viajes[0].paradas[0], { estado: "no_atendida", vigente: false, cierreEn: hora(510) });
  expect(proyectar(s, 510).viajes[0].paradas[0]).toMatchObject({ paradaId: "B", llegada: hora(540), ubicacionSupuesta: true });
});
it("no atendida con llegada prueba ubicación y usa A → B", () => {
  const s = estado(); Object.assign(s.viajes[0].paradas[0], { estado: "no_atendida", vigente: false, llegadaEn: hora(500), cierreEn: hora(510) });
  expect(proyectar(s, 510).viajes[0].paradas[0]).toMatchObject({ llegada: hora(525), ubicacionSupuesta: false });
});
it("descarga sin terminar se acota por ahora, reales intactos y sin alertas de cerradas", () => {
  const s = estado(), v = s.viajes[0]; v.regresoPatioEn = hora(590);
  v.paradas.forEach(p => { p.estado = "completada"; p.cierreEn = p.finEstimado; p.llegadaEn = p.llegadaEstimada; });
  const p = proyectar(s, 620);
  expect(p.viajes[0]).toMatchObject({ regreso: hora(590), finDescarga: hora(620), paradas: [] });
  expect(p.alertas).toEqual([]);
});
it("segundo viaje espera descarga proyectada; cada ruta usa su modelo", () => {
  const s = estado(), segundo = structuredClone(s.viajes[0]);
  segundo.rutaId = "r2"; segundo.salidaPatioEn = null; segundo.tiempos!.minLibres[0][1] = 5;
  s.viajes.push(segundo);
  const p = proyectar(s, 570);
  expect(p.viajes[1].salida).toBe(p.viajes[0].finDescarga);
  expect(Date.parse(p.viajes[1].paradas[0].llegada) - Date.parse(p.viajes[1].salida)).toBe(5 * 60000);
});
it("fuera de turno y check-out sin alertas", () => {
  const s = estado();
  expect(proyectar(s, 960).alertas).toContainEqual({ tipo: "fuera_de_turno", rutaId: "r", paradaId: null, minutos: 100, enViajeEnCurso: true });
  s.checkOutEn = hora(1100);
  expect(proyectar(s, 1100).alertas).toEqual([]);
});
it("ruta antigua: encadena diferencias y acota todos los pendientes por ahora", () => {
  const s = estado(); s.viajes[0].tiempos = null; s.viajes[0].salidaPatioEn = hora(480);
  const p = proyectar(s, 660).viajes[0];
  expect(p).toMatchObject({ aproximada: true, salida: hora(480), regreso: hora(745), finDescarga: hora(765) });
  expect(p.paradas.map(p => [p.llegada, p.inicio, p.fin])).toEqual([
    [hora(660), hora(660), hora(680)], [hora(695), hora(700), hora(720)]]);
});
it.each([480.5, 480 + 1 / 60000])("redondea salida fraccionaria %d sin alterar el real", salida => {
  const s = estado(); s.viajes[0].salidaPatioEn = hora(salida);
  const p = proyectar(s, salida).viajes[0];
  expect(p.salida).toBe(hora(salida)); expect(p.paradas[0].llegada).toBe(hora(501));
});
it("cruza medianoche sin reiniciar minutos", () => {
  const s = estado(); s.viajes[0].salidaPatioEn = hora(1430.5);
  expect(proyectar(s, 1430.5).viajes[0].paradas[0].llegada).toBe(hora(1451));
});
it("propiedad: pendientes desde ahora, secuencia monótona, reales y entrada intactos", () => {
  fc.assert(fc.property(fc.integer({ min: 490, max: 1500 }), fc.boolean(), (ahora, antigua) => {
    const s = estado(); if (antigua) s.viajes[0].tiempos = null;
    const original = structuredClone(s), p = proyectar(s, ahora).viajes[0];
    const hitos = [...p.paradas.flatMap(p => [p.llegada, p.inicio, p.fin]), p.regreso, p.finDescarga].map(Date.parse);
    expect(hitos).toEqual([...hitos].sort((a, b) => a - b));
    expect(hitos.every(t => t >= Date.parse(hora(ahora)))).toBe(true);
    expect(p.salida).toBe(s.viajes[0].salidaPatioEn); expect(s).toEqual(original);
  }));
});
it("libera futuros, elimina vacíos e ignora históricas", () => {
  const s = estado(); s.viajes[0].salidaPatioEn = null;
  const siguiente = structuredClone(s.viajes[0]); siguiente.rutaId = "r2"; siguiente.paradas = [siguiente.paradas[1]];
  s.viajes[0].paradas = [s.viajes[0].paradas[0]]; s.viajes.push(siguiente);
  const f = fronteraDeReruteo(s, true, hora(480), { ...opciones(480), liberadas: new Set(["A"]) });
  expect(f).toMatchObject({ ok: true, admitidas: [["B"]], aReubicar: ["A"], liberadas: ["A"] });
  s.viajes[0].paradas[0].vigente = false; s.viajes[0].paradas[0].estado = "reasignada";
  expect(fronteraDeReruteo(s, false, hora(480), { ...opciones(480), liberadas: new Set(["A"]) })).toMatchObject({ ok: true, liberadas: [] });
});
it("liberación parcial conserva orden", () => {
  const s = estado(); s.viajes[0].salidaPatioEn = null;
  expect(fronteraDeReruteo(s, true, hora(480), { ...opciones(480), liberadas: new Set(["B"]) }))
    .toMatchObject({ ok: true, admitidas: [["A"]], aReubicar: ["B"] });
});
it.each(["curso", "cerrada", "sitio", "servicio", "no_disponible", "check_out"])("rechaza liberar %s", caso => {
  const s = estado(); if (caso !== "curso") s.viajes[0].salidaPatioEn = null;
  if (caso === "cerrada") s.viajes[0].paradas[0].estado = "completada";
  if (caso === "sitio") s.viajes[0].paradas[0].estado = "en_sitio";
  if (caso === "servicio") s.viajes[0].paradas[0].estado = "en_servicio";
  if (caso === "check_out") s.checkOutEn = hora(480);
  expect(fronteraDeReruteo(s, caso !== "no_disponible", hora(480), { ...opciones(480), liberadas: new Set(["A"]) }).ok).toBe(false);
});
it("la frontera se mueve con el reloj sin eventos nuevos", () => {
  const s = estado();
  expect(fronteraDeReruteo(s, true, hora(520), { ...opciones(520), liberadas: new Set() })).toMatchObject({ libreDesdeMin: 620 });
  expect(fronteraDeReruteo(s, true, hora(570), { ...opciones(570), liberadas: new Set() })).toMatchObject({ libreDesdeMin: 670 });
});
it("aplica las franjas guardadas en el viaje", () => {
  const s = estado(); s.viajes[0].salidaPatioEn = hora(480);
  s.viajes[0].tiempos!.horasPico = [{ inicioMin: 420, finMin: 570, factor: 1.3 }];
  // 20 × 1.3 = 26; servicio 20; 15 × 1.3 = 19.5, llegada B 545.5 → 546.
  expect(proyectar(s, 480).viajes[0].paradas.map(p => p.llegada)).toEqual([hora(506), hora(546)]);
});
it("el siguiente viaje antiguo también espera al anterior y al reloj", () => {
  const s = estado(); s.viajes[0].tiempos = null;
  const v = structuredClone(s.viajes[0]); v.rutaId = "r2"; v.salidaPatioEn = null; s.viajes.push(v);
  const p = proyectar(s, 660);
  expect(p.viajes[1].salida).toBe(p.viajes[0].finDescarga);
  expect(Date.parse(p.viajes[1].paradas[0].llegada) - Date.parse(p.viajes[1].salida)).toBe(20 * 60000);
});
it("conserva literalmente los hitos reales con offset y milisegundos", () => {
  const s = estado(), v = s.viajes[0], a = v.paradas[0];
  v.salidaPatioEn = "2026-10-15T08:10:00.123-06:00";
  a.estado = "en_servicio"; a.llegadaEn = "2026-10-15T08:30:00.456-06:00";
  a.inicioServicioEn = "2026-10-15T08:31:00.789-06:00";
  const p = proyectar(s, 540).viajes[0];
  expect(p.salida).toBe(v.salidaPatioEn);
  expect(p.paradas[0]).toMatchObject({ llegada: a.llegadaEn, inicio: a.inicioServicioEn, fin: hora(540) });
});
