import { describe, expect, it } from "vitest";
import { siguienteAccion, proyectarEvento } from "./siguiente-accion";
import { aplicarEvento } from "./index";
import type { EstadoJornada, EventoEntrada, TipoEvento } from "./tipos";
const hora = "2026-10-15T14:00:00.000Z";
function inicial(): EstadoJornada {
  return { jornadaId: "j", fecha: "2026-10-15", checkInEn: null, checkOutEn: null,
    ultimoOcurridoEn: null, ultimoOdometroKm: null, viajes: [1, 2].map(n => ({
      rutaId: `r${n}`, version: n, salidaEstimada: hora, regresoEstimado: hora, finDescargaEstimado: hora,
      salidaPatioEn: null, regresoPatioEn: null, descargaFinEn: null, odometroInicioKm: null,
      paradas: [1, 2].map(p => ({ paradaId: `${n}-${p}`, solicitudId: `${n}-${p}`, secuencia: p,
        estado: "pendiente", vigente: true, llegadaEstimada: hora, inicioEstimado: hora, finEstimado: hora,
        llegadaEn: null, inicioServicioEn: null, cierreEn: null })),
    })) };
}
function avanzar(s: EstadoJornada, tipo?: TipoEvento) {
  const a = siguienteAccion(s)!;
  const e: EventoEntrada = { eventoId: "e", jornadaId: s.jornadaId, ocurridoEn: hora,
    tipo: tipo ?? a.tipo, rutaId: a.rutaId, paradaId: a.paradaId, versionRuta: a.versionRuta,
    odometroKm: ["salida_patio", "regreso_patio"].includes(a.tipo) ? 100 : null,
    motivo: tipo === "no_atendida" ? "Cliente cerrado" : null };
  expect(aplicarEvento(s, e, hora).ok).toBe(true);
  const antes = structuredClone(s);
  const resultado = proyectarEvento(s, e);
  expect(s).toEqual(antes);
  return resultado;
}
describe("siguiente acción del operador", () => {
  it("recorre dos viajes, descarga antes del siguiente y termina sin más acciones", () => {
    let s = inicial();
    const esperados: TipoEvento[] = ["check_in", ...([1, 2].flatMap(() => ["salida_patio", "llegada", "inicio_servicio", "fin_servicio", "llegada", "inicio_servicio", "fin_servicio", "regreso_patio", "fin_descarga"] as TipoEvento[])), "check_out"];
    for (const tipo of esperados) {
      const accion = siguienteAccion(s)!;
      expect(accion.tipo).toBe(tipo);
      expect(accion.permiteNoAtendida).toBe(tipo === "llegada" || tipo === "inicio_servicio");
      s = avanzar(s);
    }
    expect(siguienteAccion(s)).toBeNull();
  });
  it("salta la no atendida y conserva las referencias y versión de la siguiente", () => {
    let s = avanzar(avanzar(inicial()));
    s = avanzar(s, "no_atendida");
    expect(siguienteAccion(s)).toMatchObject({ tipo: "llegada", paradaId: "1-2", rutaId: "r1", versionRuta: 1 });
  });
  it("sin viajes permite check-in y check-out", () => {
    const s = inicial(); s.viajes = [];
    expect(siguienteAccion(avanzar(s))?.tipo).toBe("check_out");
  });
  it("ordena las paradas por secuencia y omite las retiradas por re-ruteo", () => {
    let s = avanzar(avanzar(inicial()));
    s.viajes[0].paradas.reverse();
    expect(siguienteAccion(s)?.paradaId).toBe("1-1");
    s.viajes[0].paradas[1].vigente = false;
    s.viajes[0].paradas[1].estado = "reasignada";
    expect(siguienteAccion(s)?.paradaId).toBe("1-2");
    s = avanzar(s);
    expect(siguienteAccion(s)?.tipo).toBe("inicio_servicio");
  });
  it("no proyecta un evento inválido", () => {
    const s = inicial();
    expect(proyectarEvento(s, { eventoId: "e", jornadaId: "j", tipo: "check_out", ocurridoEn: hora,
      rutaId: null, paradaId: null, versionRuta: null, odometroKm: null, motivo: null })).toEqual(s);
  });
});
