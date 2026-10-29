import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { miRuta } from "@/consultas/operador.nucleo";
import { obtenerPlan } from "@/consultas/plan.nucleo";
import { seguimiento } from "@/consultas/operacion.nucleo";
import type { BD } from "@/datos/bd";
import { configuracion, eventosOperador, incidentes, jornadas, paradas, planes, rutas, solicitudes } from "@/datos/esquema";
import { crearBdPrueba } from "@/datos/pruebas/bd-prueba";
import {
  AHORA_PLAN, clienteHabilitado, FECHA_PLAN, jornadaDisponible, ponerPatio, solicitudPendiente, usuarioOperadorDe,
} from "@/datos/pruebas/escenario-plan";
import { usuarioDePrueba } from "@/datos/pruebas/usuarios-prueba";
import type { EventoEntrada, TipoEvento } from "@/dominio/operacion/tipos";
import type { UsuarioSesion } from "@/seguridad/permisos";
import { conciliarEvento, resolverIncidente } from "./operacion.nucleo";
import { registrarEventoOperador, reportarIncidente } from "./operador.nucleo";
import { ajustarPlanDelDia, generarPlanDelDia, iniciarRevision, validarPlanDelDia } from "./plan.nucleo";
import { generarReruteo } from "./reruteo.nucleo";
import type { Contexto, Resultado } from "./tipos";

function valor<T>(r: Resultado<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.valor;
}

/** Minutos después de las 07:00 de Ciudad de México del jueves del plan. */
const a = (min: number) => new Date(AHORA_PLAN.getTime() + min * 60_000);

describe("operación del día", () => {
  let bd: BD;
  let despachador: UsuarioSesion;
  let operadorA: UsuarioSesion;
  let jornadaA: { unidadId: string; operadorId: string; jornadaId: string };
  let jornadaB: { unidadId: string; operadorId: string; jornadaId: string };
  const ctx = (usuario: UsuarioSesion, ahora = AHORA_PLAN): Contexto => ({ bd, usuario, ahora, reloj: () => ahora });

  /** Plan validado de hoy con dos unidades pequeñas: dos solicitudes por unidad, en un solo viaje cada una. */
  beforeEach(async () => {
    bd = await crearBdPrueba();
    despachador = await usuarioDePrueba(bd, "despachador");
    await ponerPatio(bd);
    // Plan 8: sin horas pico. Con ellas, el reacomodo junta los dos viajes en una unidad (el segundo sale después de la
    // hora pico y gasta menos tiempo muerto) y estas pruebas necesitan un viaje por unidad.
    await bd.update(configuracion).set({ horasPico: [] }).where(eq(configuracion.id, 1));
    jornadaA = await jornadaDisponible(bd, FECHA_PLAN, "OPA001", { capacidadKg: 1700 });
    jornadaB = await jornadaDisponible(bd, FECHA_PLAN, "OPB002", { capacidadKg: 1700 });
    operadorA = await usuarioOperadorDe(bd, jornadaA.operadorId);
    for (const [i, nombre] of ["Norte", "Centro", "Sur", "Oriente"].entries()) {
      const c = await clienteHabilitado(bd, `Cartonera ${nombre}`, 0.01 * (i + 1));
      await solicitudPendiente(bd, c.id, despachador.id, FECHA_PLAN, new Date(AHORA_PLAN.getTime() - (4 - i) * 60_000));
    }
    const { planId } = valor(await generarPlanDelDia(ctx(despachador), FECHA_PLAN));
    valor(await iniciarRevision(ctx(despachador), planId));
    const [p] = await bd.select({ version: planes.version }).from(planes).where(eq(planes.id, planId));
    valor(await validarPlanDelDia(ctx(despachador), planId, p.version, { requisitosConfirmados: true }));
  });

  async function rutaDe(usuario: UsuarioSesion, ahora = AHORA_PLAN) {
    return valor(await miRuta(ctx(usuario, ahora)));
  }

  function evento(tipo: TipoEvento, ocurridoEn: Date, cambios: Partial<EventoEntrada> = {}): EventoEntrada {
    return {
      eventoId: randomUUID(), jornadaId: jornadaA.jornadaId, tipo, ocurridoEn: ocurridoEn.toISOString(),
      rutaId: null, paradaId: null, versionRuta: null, odometroKm: null, motivo: null, ...cambios,
    };
  }

  async function enviar(e: EventoEntrada, ahora = new Date(e.ocurridoEn)) {
    return registrarEventoOperador(ctx(operadorA, ahora), e);
  }

  it("el operador ve solo su jornada, con sus paradas en orden", async () => {
    const vista = await rutaDe(operadorA);
    expect(vista.jornadaId).toBe(jornadaA.jornadaId);
    expect(vista.viajes).toHaveLength(1);
    expect(vista.viajes[0].paradas.map((p) => p.secuencia)).toEqual([1, 2]);
    const ajeno = await usuarioOperadorDe(bd, jornadaB.operadorId);
    expect(valor(await miRuta(ctx(ajeno))).jornadaId).toBe(jornadaB.jornadaId);
    expect(await registrarEventoOperador(ctx(ajeno), evento("check_in", a(55)))).toEqual({ ok: false, error: "no_encontrado" });
    expect(await miRuta(ctx(despachador))).toEqual({ ok: false, error: "no_autorizado" });
  });

  it("una jornada completa deja horas reales, odómetros, solicitudes atendidas y check_out", async () => {
    const viaje = (await rutaDe(operadorA)).viajes[0];
    const r = { rutaId: viaje.rutaId, versionRuta: viaje.version };
    let t = 55;
    const paso = async (tipo: TipoEvento, cambios: Partial<EventoEntrada> = {}) => {
      t += 5;
      const resultado = valor(await enviar(evento(tipo, a(t), cambios)));
      expect(resultado).toMatchObject({ resultado: "aplicado", repetido: false });
    };
    await paso("check_in");
    await paso("salida_patio", { ...r, odometroKm: 1000 });
    for (const p of viaje.paradas) {
      await paso("llegada", { ...r, paradaId: p.paradaId });
      await paso("inicio_servicio", { ...r, paradaId: p.paradaId });
      await paso("fin_servicio", { ...r, paradaId: p.paradaId });
    }
    await paso("regreso_patio", { ...r, odometroKm: 1032.5 });
    await paso("fin_descarga", r);
    await paso("check_out");

    const [ruta] = await bd.select().from(rutas).where(eq(rutas.id, viaje.rutaId));
    expect(ruta).toMatchObject({ odometroInicioKm: 1000, odometroFinKm: 1032.5 });
    expect(ruta.salidaPatioEn).toEqual(a(65));
    expect(ruta.descargaFinEn).not.toBeNull();
    const suyas = await bd.select().from(paradas).where(eq(paradas.rutaId, viaje.rutaId));
    expect(suyas.every((p) => p.estado === "completada" && p.llegadaEn && p.inicioServicioEn && p.finServicioEn && p.cierreEn)).toBe(true);
    const ids = suyas.map((p) => p.solicitudId);
    expect((await bd.select().from(solicitudes)).filter((s) => ids.includes(s.id)).map((s) => s.estado)).toEqual(["atendida", "atendida"]);
    const [j] = await bd.select().from(jornadas).where(eq(jornadas.id, jornadaA.jornadaId));
    expect(j.checkOutEn).not.toBeNull();
    expect(j.versionOperacion).toBe(11);
    expect(valor(await enviar(evento("check_in", a(t + 5)))).resultado).toBe("rechazado");
  });

  it("un evento repetido no se aplica dos veces y responde su resultado original; con otro contenido, conflicto", async () => {
    const e = evento("check_in", a(55));
    expect(valor(await enviar(e))).toMatchObject({ resultado: "aplicado", repetido: false });
    expect(valor(await enviar(e, a(70)))).toMatchObject({ resultado: "aplicado", repetido: true });
    expect(await bd.select().from(eventosOperador)).toHaveLength(1);
    const [j] = await bd.select().from(jornadas).where(eq(jornadas.id, jornadaA.jornadaId));
    expect(j.versionOperacion).toBe(1);
    expect(await enviar({ ...e, ocurridoEn: a(56).toISOString() })).toMatchObject({ ok: false, error: "conflicto", motivo: { codigo: "evento_distinto" } });
  });

  it("una transición inválida se guarda como rechazada, sin cambios, y se puede conciliar", async () => {
    const viaje = (await rutaDe(operadorA)).viajes[0];
    const invalido = evento("fin_servicio", a(60), { rutaId: viaje.rutaId, versionRuta: viaje.version, paradaId: viaje.paradas[0].paradaId });
    const r = valor(await enviar(invalido));
    expect(r.resultado).toBe("rechazado");
    expect(r.motivo).toBeTruthy();
    const [guardado] = await bd.select().from(eventosOperador);
    expect(guardado).toMatchObject({ resultado: "rechazado", eventoId: invalido.eventoId });
    expect((await bd.select().from(paradas).where(eq(paradas.id, viaje.paradas[0].paradaId)))[0].estado).toBe("pendiente");
    const vista = valor(await seguimiento(ctx(despachador, a(61))));
    expect(vista.eventosRechazados.map((x) => x.eventoId)).toEqual([invalido.eventoId]);
    valor(await conciliarEvento(ctx(despachador, a(62)), invalido.eventoId, { nota: "Se acordó por teléfono" }));
    expect(valor(await seguimiento(ctx(despachador, a(63)))).eventosRechazados).toEqual([]);
  });

  it("no atendida libera la parada y devuelve la solicitud al siguiente día de operación", async () => {
    const viaje = (await rutaDe(operadorA)).viajes[0];
    const r = { rutaId: viaje.rutaId, versionRuta: viaje.version };
    valor(await enviar(evento("check_in", a(55))));
    valor(await enviar(evento("salida_patio", a(60), { ...r, odometroKm: 500 })));
    const primera = viaje.paradas[0];
    expect(valor(await enviar(evento("no_atendida", a(75), { ...r, paradaId: primera.paradaId, motivo: "Cerrado" }))).resultado).toBe("aplicado");
    const [p] = await bd.select().from(paradas).where(eq(paradas.id, primera.paradaId));
    expect(p).toMatchObject({ estado: "no_atendida", vigente: false, motivoNoAtendida: "Cerrado" });
    const [s] = await bd.select().from(solicitudes).where(eq(solicitudes.id, p.solicitudId));
    expect(s).toMatchObject({ estado: "pendiente", proximaFechaElegible: "2026-10-16", vecesPospuesta: 1 });
  });

  it("un incidente es idempotente; cancelar su parada pendiente cancela la solicitud", async () => {
    const viaje = (await rutaDe(operadorA)).viajes[0];
    const parada = viaje.paradas[1];
    const entrada = { eventoId: randomUUID(), jornadaId: jornadaA.jornadaId, tipo: "cliente_no_disponible", descripcion: "No abre hoy", paradaId: parada.paradaId };
    const { id } = valor(await reportarIncidente(ctx(operadorA, a(50)), entrada));
    expect(valor(await reportarIncidente(ctx(operadorA, a(51)), entrada))).toEqual({ id, repetido: true });
    expect(await bd.select().from(incidentes)).toHaveLength(1);
    const [inc] = await bd.select().from(incidentes);
    valor(await resolverIncidente(ctx(despachador, a(52)), id, inc.version, { accion: "cancelar" }));
    const [p] = await bd.select().from(paradas).where(eq(paradas.id, parada.paradaId));
    expect(p).toMatchObject({ estado: "omitida", vigente: false });
    expect((await bd.select().from(solicitudes).where(eq(solicitudes.id, p.solicitudId)))[0]).toMatchObject({ estado: "cancelada", motivoCancelacion: "Cancelada por incidente" });
    expect(valor(await seguimiento(ctx(despachador, a(53)))).incidentesAbiertos).toEqual([]);
  });

  it("re-ruteo por avería: el viaje en curso de A se conserva, lo de B se reubica y el plan base queda reemplazado", async () => {
    const viajeA = (await rutaDe(operadorA)).viajes[0];
    valor(await enviar(evento("check_in", a(55))));
    valor(await enviar(evento("salida_patio", a(60), { rutaId: viajeA.rutaId, versionRuta: viajeA.version, odometroKm: 100 })));
    const [base] = await bd.select().from(planes).where(eq(planes.estado, "validado"));
    const ahora = a(70);
    const { planId } = valor(await generarReruteo(ctx(despachador, ahora), base.id, base.version, { jornadasNoDisponibles: [jornadaB.jornadaId] }));
    const propuesta = valor(await obtenerPlan(ctx(despachador, ahora), FECHA_PLAN, planId));
    expect(propuesta).toMatchObject({ tipo: "re_ruteo", estado: "propuesto" });
    const delViajeEnCurso = (await bd.select({ id: paradas.solicitudId }).from(paradas).where(eq(paradas.rutaId, viajeA.rutaId))).map((x) => x.id);
    expect([...propuesta.congeladas].sort()).toEqual([...delViajeEnCurso].sort());
    expect(valor(await obtenerPlan(ctx(despachador, ahora), FECHA_PLAN)).reruteoPropuesto).toEqual({ planId });

    valor(await iniciarRevision(ctx(despachador, ahora), planId));
    const [p] = await bd.select().from(planes).where(eq(planes.id, planId));
    const r = valor(await validarPlanDelDia(ctx(despachador, ahora), planId, p.version, { requisitosConfirmados: true }));
    expect(r.programadas + r.pospuestas).toBe(2);
    const estados = Object.fromEntries((await bd.select().from(planes)).map((x) => [x.id, x.estado]));
    expect(estados[base.id]).toBe("reemplazado");
    expect(estados[planId]).toBe("validado");
    // Las paradas del viaje en curso de A siguen vigentes en el plan base; las de B ya no.
    const vigentesA = await bd.select().from(paradas).where(eq(paradas.rutaId, viajeA.rutaId));
    expect(vigentesA.every((x) => x.vigente)).toBe(true);
    const vigentesPorSolicitud = (await bd.execute(sql`SELECT solicitud_id, count(*)::int AS n FROM paradas WHERE vigente GROUP BY solicitud_id`)) as unknown as { rows?: { n: number }[] };
    expect((vigentesPorSolicitud.rows ?? []).every((x) => x.n === 1)).toBe(true);
    // El operador A sigue operando su viaje en curso con la versión que tenía.
    const primera = viajeA.paradas[0];
    expect(valor(await enviar(evento("llegada", a(75), { rutaId: viajeA.rutaId, versionRuta: viajeA.version, paradaId: primera.paradaId }))).resultado).toBe("aplicado");
  });

  it("si la operación avanza mientras se revisa el re-ruteo, validar responde operacion_avanzo", async () => {
    const [base] = await bd.select().from(planes).where(eq(planes.estado, "validado"));
    const { planId } = valor(await generarReruteo(ctx(despachador, a(50)), base.id, base.version, { jornadasNoDisponibles: [jornadaB.jornadaId] }));
    valor(await iniciarRevision(ctx(despachador, a(51)), planId));
    valor(await enviar(evento("check_in", a(52))));
    const [p] = await bd.select().from(planes).where(eq(planes.id, planId));
    expect(await validarPlanDelDia(ctx(despachador, a(53)), planId, p.version, { requisitosConfirmados: true })).toMatchObject({
      ok: false, error: "conflicto", motivo: { codigo: "operacion_avanzo" },
    });
  });

  it("check_in responde ya con la jornada actualizada", async () => {
    const r = valor(await enviar(evento("check_in", a(55))));
    expect(r.estado.checkInEn).not.toBeNull();
  });

  it("un rechazo con una parada que no existe también queda guardado, y repetirlo responde lo mismo", async () => {
    valor(await enviar(evento("check_in", a(55))));
    const e = evento("llegada", a(60), { rutaId: randomUUID(), paradaId: randomUUID(), versionRuta: 1 });
    expect(valor(await enviar(e))).toMatchObject({ resultado: "rechazado", repetido: false });
    const [guardado] = await bd.select().from(eventosOperador).where(eq(eventosOperador.eventoId, e.eventoId));
    expect(guardado).toMatchObject({ resultado: "rechazado", rutaId: null, paradaId: null });
    expect(valor(await enviar(e, a(61)))).toMatchObject({ resultado: "rechazado", repetido: true });
  });

  it("en una propuesta de re-ruteo no se puede posponer una admitida; un plan reemplazado no se ajusta", async () => {
    const viajeA = (await rutaDe(operadorA)).viajes[0];
    valor(await enviar(evento("check_in", a(55))));
    valor(await enviar(evento("salida_patio", a(60), { rutaId: viajeA.rutaId, versionRuta: viajeA.version, odometroKm: 100 })));
    const [base] = await bd.select().from(planes).where(eq(planes.estado, "validado"));
    // Nadie deja de estar disponible: el viaje de B, que no ha salido, queda como admitidas.
    const { planId } = valor(await generarReruteo(ctx(despachador, a(65)), base.id, base.version, { jornadasNoDisponibles: [] }));
    const [p] = await bd.select().from(planes).where(eq(planes.id, planId));
    const admitida = (p.restricciones as { admitidas: Record<string, string[][]> }).admitidas[jornadaB.jornadaId][0][0];
    expect(await ajustarPlanDelDia(ctx(despachador, a(66)), planId, p.version, { tipo: "posponer", solicitudId: admitida })).toMatchObject({ ok: false, error: "invalido" });

    valor(await iniciarRevision(ctx(despachador, a(66)), planId));
    const [p2] = await bd.select().from(planes).where(eq(planes.id, planId));
    valor(await validarPlanDelDia(ctx(despachador, a(67)), planId, p2.version, { requisitosConfirmados: true }));
    const [reemplazado] = await bd.select().from(planes).where(eq(planes.id, base.id));
    expect(reemplazado.estado).toBe("reemplazado");
    const cualquiera = (reemplazado.resultado.rutas.flatMap((r) => r.viajes.flatMap((v) => v.paradas)))[0].solicitudId;
    expect(await ajustarPlanDelDia(ctx(despachador, a(68)), base.id, reemplazado.version, { tipo: "posponer", solicitudId: cualquiera })).toMatchObject({
      ok: false, error: "conflicto",
    });
  });

  it("una jornada que ya hizo check-out no recibe trabajo en un re-ruteo", async () => {
    const viaje = (await rutaDe(operadorA)).viajes[0];
    const r = { rutaId: viaje.rutaId, versionRuta: viaje.version };
    let t = 55;
    const paso = async (tipo: TipoEvento, cambios: Partial<EventoEntrada> = {}) => expect(valor(await enviar(evento(tipo, a((t += 5)), cambios))).resultado).toBe("aplicado");
    await paso("check_in");
    await paso("salida_patio", { ...r, odometroKm: 1 });
    for (const p of viaje.paradas) {
      await paso("llegada", { ...r, paradaId: p.paradaId });
      await paso("inicio_servicio", { ...r, paradaId: p.paradaId });
      await paso("fin_servicio", { ...r, paradaId: p.paradaId });
    }
    await paso("regreso_patio", { ...r, odometroKm: 2 });
    await paso("fin_descarga", r);
    await paso("check_out");
    const c = await clienteHabilitado(bd, "Cartonera Tardía", 0.005);
    await solicitudPendiente(bd, c.id, despachador.id, FECHA_PLAN, a(t));
    const [base] = await bd.select().from(planes).where(eq(planes.estado, "validado"));
    const { planId } = valor(await generarReruteo(ctx(despachador, a(t + 5)), base.id, base.version, { jornadasNoDisponibles: [] }));
    const [p] = await bd.select().from(planes).where(eq(planes.id, planId));
    expect(p.entrada.unidades.map((u) => u.id)).toEqual([jornadaB.jornadaId]);
  });
});
