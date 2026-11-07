import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { obtenerPlan } from "@/consultas/plan.nucleo";
import { colaDeSolicitudes } from "@/consultas/solicitudes.nucleo";
import type { BD } from "@/datos/bd";
import { bitacora, clientes, ejecucionesMotor, paradas, planes, rutas, solicitudes } from "@/datos/esquema";
import { crearBdPrueba } from "@/datos/pruebas/bd-prueba";
import {
  AHORA_PLAN, clienteHabilitado, FECHA_PLAN, jornadaDisponible, ponerPatio, solicitudPendiente,
} from "@/datos/pruebas/escenario-plan";
import { insertarMovimientoPrivacidad } from "@/datos/privacidad";
import { unidadDePrueba } from "@/datos/pruebas/flota-ejemplo";
import { usuarioDePrueba } from "@/datos/pruebas/usuarios-prueba";
import type { UsuarioSesion } from "@/seguridad/permisos";
import { guardarUnidad } from "./flota.nucleo";
import { cancelarSolicitud } from "./solicitudes.nucleo";
import { quitarJornada } from "./jornada.nucleo";
import { ajustarPlanDelDia, descartarPlan, generarPlanDelDia, iniciarRevision, validarPlanDelDia } from "./plan.nucleo";
import type { Contexto, Resultado } from "./tipos";

function valor<T>(r: Resultado<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.valor;
}

const minutos = (m: number) => new Date(AHORA_PLAN.getTime() + m * 60_000);

describe("plan del día", () => {
  let bd: BD;
  let despachador: UsuarioSesion;
  let gerencia: UsuarioSesion;
  let jornada: { unidadId: string; operadorId: string; jornadaId: string };
  let solicitudIds: string[];
  const ctx = (usuario: UsuarioSesion | null = despachador, ahora = AHORA_PLAN, reloj?: () => Date): Contexto => ({ bd, usuario, ahora, reloj });

  beforeEach(async () => {
    bd = await crearBdPrueba();
    despachador = await usuarioDePrueba(bd, "despachador");
    gerencia = await usuarioDePrueba(bd, "gerencia");
    await ponerPatio(bd);
    jornada = await jornadaDisponible(bd, FECHA_PLAN, "PLAN01");
    solicitudIds = [];
    for (const [i, nombre] of ["Cartonera Norte", "Papelera Centro", "Empaques Sur"].entries()) {
      const c = await clienteHabilitado(bd, nombre, 0.01 * (i + 1));
      solicitudIds.push(await solicitudPendiente(bd, c.id, despachador.id, FECHA_PLAN, new Date(AHORA_PLAN.getTime() - (3 - i) * 60_000)));
    }
  });

  async function generar(ahora = AHORA_PLAN): Promise<{ planId: string; version: number }> {
    const { planId } = valor(await generarPlanDelDia(ctx(despachador, ahora), FECHA_PLAN));
    const [p] = await bd.select({ version: planes.version }).from(planes).where(eq(planes.id, planId));
    return { planId, version: p.version };
  }

  async function revisarYValidar(planId: string, version: number, reloj?: () => Date) {
    valor(await iniciarRevision(ctx(), planId));
    return validarPlanDelDia(ctx(despachador, AHORA_PLAN, reloj), planId, version, { requisitosConfirmados: true });
  }

  it("autoriza: gerencia ve pero no genera ni valida; un operador ni ve", async () => {
    const operador = await usuarioDePrueba(bd, "operador");
    expect(await generarPlanDelDia(ctx(gerencia), FECHA_PLAN)).toEqual({ ok: false, error: "no_autorizado" });
    expect(await obtenerPlan(ctx(operador), FECHA_PLAN)).toEqual({ ok: false, error: "no_autorizado" });
    const { planId, version } = await generar();
    expect((await obtenerPlan(ctx(gerencia), FECHA_PLAN)).ok).toBe(true);
    expect(await iniciarRevision(ctx(gerencia), planId)).toEqual({ ok: false, error: "no_autorizado" });
    expect(await validarPlanDelDia(ctx(gerencia), planId, version, { requisitosConfirmados: true })).toEqual({ ok: false, error: "no_autorizado" });
  });

  it("no genera sin patio, para una fecha pasada ni para un día sin operación", async () => {
    expect(await generarPlanDelDia(ctx(), "2026-10-14")).toMatchObject({ ok: false, error: "invalido", campos: { fecha: expect.any(Array) } });
    expect(await generarPlanDelDia(ctx(), "2026-10-18")).toMatchObject({ ok: false, error: "invalido", campos: { fecha: ["Ese día no es de operación"] } });
    await bd.execute(sql`UPDATE configuracion SET patio_lat = NULL, patio_lng = NULL`);
    expect(await generarPlanDelDia(ctx(), FECHA_PLAN)).toMatchObject({ ok: false, error: "invalido", campos: { _: [expect.stringContaining("patio")] } });
    expect(await bd.select().from(ejecucionesMotor)).toEqual([]);
  });

  it("genera una propuesta con su ejecución (K7) y la muestra por unidad; regenerar descarta la anterior", async () => {
    const { planId } = await generar();
    const vista = valor(await obtenerPlan(ctx(), FECHA_PLAN));
    expect(vista).toMatchObject({ planId, estado: "propuesto", revisionIniciada: false, ajustes: 0, puedeGenerar: true, puedeValidar: true });
    expect(vista.unidades).toHaveLength(1);
    expect(vista.unidades[0].viajes.flatMap((v) => v.paradas.map((p) => p.solicitudId)).sort()).toEqual([...solicitudIds].sort());
    expect(vista.unidades[0].viajes[0].salida).toBe("08:00");
    expect(vista.resumen).toMatchObject({ ruteadas: 3, pospuestas: 0 });
    expect(vista.ultimaEjecucion).toMatchObject({ resultado: "ok" });
    const [ejecucion] = await bd.select().from(ejecucionesMotor);
    expect(ejecucion).toMatchObject({ planId, resultado: "ok", fecha: FECHA_PLAN, usuarioId: despachador.id, error: null });

    const segundo = await generar();
    const estados = await bd.select({ id: planes.id, estado: planes.estado }).from(planes);
    expect(estados).toEqual(expect.arrayContaining([{ id: planId, estado: "descartado" }, { id: segundo.planId, estado: "propuesto" }]));
    expect((await bd.select().from(solicitudes)).every((s) => s.estado === "pendiente")).toBe(true);
  });

  it("iniciar la revisión fija la hora una sola vez y no cambia la versión", async () => {
    const { planId, version } = await generar();
    valor(await iniciarRevision(ctx(despachador, minutos(5)), planId));
    valor(await iniciarRevision(ctx(despachador, minutos(9)), planId));
    const [p] = await bd.select().from(planes).where(eq(planes.id, planId));
    expect(p.revisionIniciadaEn).toEqual(minutos(5));
    expect(p.version).toBe(version);
    expect((await bd.select().from(bitacora).where(eq(bitacora.accion, "iniciar_revision")))).toHaveLength(1);
  });

  it("validar exige revisión iniciada y la confirmación de requisitos", async () => {
    const { planId, version } = await generar();
    expect(await validarPlanDelDia(ctx(), planId, version, { requisitosConfirmados: true })).toMatchObject({ ok: false, error: "invalido", campos: { _: [expect.stringContaining("revisarlo")] } });
    valor(await iniciarRevision(ctx(), planId));
    expect(await validarPlanDelDia(ctx(), planId, version, {})).toMatchObject({ ok: false, error: "invalido", campos: { requisitosConfirmados: expect.any(Array) } });
  });

  it("validar escribe rutas y paradas vigentes, programa las ruteadas y las muestra en la cola", async () => {
    const { planId, version } = await generar();
    expect(await revisarYValidar(planId, version)).toEqual({ ok: true, valor: { programadas: 3, pospuestas: 0 } });
    const guardadas = await bd.select().from(rutas);
    expect(guardadas).toHaveLength(1);
    expect(guardadas[0]).toMatchObject({ planId, jornadaId: jornada.jornadaId, numeroViaje: 1, rendimientoKmLUsado: 3.5, asignadaEn: AHORA_PLAN });
    expect(guardadas[0].salidaEstimada).toEqual(new Date("2026-10-15T14:00:00Z"));
    expect(guardadas[0].disponibleParaSalirEn).toEqual(new Date("2026-10-15T14:00:00Z"));
    const vigentes = await bd.select().from(paradas);
    expect(vigentes.map((p) => p.solicitudId).sort()).toEqual([...solicitudIds].sort());
    expect(vigentes.every((p) => p.vigente && p.estado === "pendiente" && p.kmContrafactual > 0)).toBe(true);
    expect(guardadas[0].kmContrafactual).toBeCloseTo(vigentes.reduce((s, p) => s + p.kmContrafactual, 0));
    expect((await bd.select().from(solicitudes)).map((s) => s.estado)).toEqual(["programada", "programada", "programada"]);
    const cola = valor(await colaDeSolicitudes(ctx(), FECHA_PLAN));
    expect(cola.elementos.map((e) => e.estado)).toEqual(["programada", "programada", "programada"]);

    expect(await validarPlanDelDia(ctx(), planId, version + 1, { requisitosConfirmados: true })).toMatchObject({ ok: false, error: "conflicto", motivo: { codigo: "plan_validado_existente" } });
    expect(await generarPlanDelDia(ctx(), FECHA_PLAN)).toMatchObject({ ok: false, error: "conflicto", motivo: { codigo: "plan_validado_existente" } });
    expect(await quitarJornada(ctx(), jornada.jornadaId, 1)).toMatchObject({ ok: false, error: "conflicto", motivo: { codigo: "jornada_con_rutas" } });
  });

  it("una solicitud de ayer programada hoy aparece en la cola de hoy", async () => {
    const c = await clienteHabilitado(bd, "Cajas de Ayer", 0.015);
    const deAyer = await solicitudPendiente(bd, c.id, despachador.id, "2026-10-14", new Date("2026-10-14T15:00:00Z"));
    const { planId, version } = await generar();
    valor(await revisarYValidar(planId, version));
    const cola = valor(await colaDeSolicitudes(ctx(), FECHA_PLAN));
    expect(cola.elementos.find((e) => e.solicitud.id === deAyer)).toMatchObject({ estado: "programada" });
  });

  it("posponer a mano y volver a mover; la pospuesta pasa al siguiente día de operación al validar", async () => {
    const { planId, version } = await generar();
    const pospuesta = solicitudIds[0];
    const v2 = valor(await ajustarPlanDelDia(ctx(), planId, version, { tipo: "posponer", solicitudId: pospuesta })).version;
    let vista = valor(await obtenerPlan(ctx(), FECHA_PLAN));
    expect(vista.pospuestas).toEqual([expect.objectContaining({ solicitudId: pospuesta, motivo: "pospuesta_a_mano", diagnostico: null })]);
    expect(vista).toMatchObject({ ajustes: 1, revisionIniciada: true });
    expect(await ajustarPlanDelDia(ctx(), planId, version, { tipo: "posponer", solicitudId: solicitudIds[1] })).toEqual({ ok: false, error: "conflicto" });

    const v3 = valor(await ajustarPlanDelDia(ctx(), planId, v2, { tipo: "mover", solicitudId: pospuesta, unidadId: jornada.jornadaId, viaje: 1, posicion: 1 })).version;
    vista = valor(await obtenerPlan(ctx(), FECHA_PLAN));
    expect(vista.pospuestas).toEqual([]);
    expect(vista.unidades[0].viajes[0].paradas[0].solicitudId).toBe(pospuesta);

    const v4 = valor(await ajustarPlanDelDia(ctx(), planId, v3, { tipo: "posponer", solicitudId: pospuesta })).version;
    expect(await validarPlanDelDia(ctx(), planId, v4, { requisitosConfirmados: true })).toEqual({ ok: true, valor: { programadas: 2, pospuestas: 1 } });
    const [s] = await bd.select().from(solicitudes).where(eq(solicitudes.id, pospuesta));
    expect(s).toMatchObject({ estado: "pendiente", proximaFechaElegible: "2026-10-16", vecesPospuesta: 1, fechaSolicitada: FECHA_PLAN });
    expect(s.registradaEn).toEqual(new Date(AHORA_PLAN.getTime() - 3 * 60_000));
    const acciones = (await bd.select().from(bitacora).where(eq(bitacora.entidad, "plan"))).map((b) => b.accion);
    expect(acciones).toEqual(expect.arrayContaining(["generar", "ajustar_posponer", "ajustar_mover", "validar"]));
  });

  it("un ajuste que no cabe se rechaza con el motivo y no cambia el plan", async () => {
    const otra = await jornadaDisponible(bd, FECHA_PLAN, "CHICA1", { capacidadKg: 500, tipo: "doble_rodada" });
    const { planId, version } = await generar();
    const r = await ajustarPlanDelDia(ctx(), planId, version, { tipo: "mover", solicitudId: solicitudIds[0], unidadId: otra.jornadaId, viaje: 1, posicion: 1 });
    expect(r).toMatchObject({ ok: false, error: "invalido", campos: { _: [expect.stringContaining("capacidad")] } });
    const [p] = await bd.select({ version: planes.version }).from(planes).where(eq(planes.id, planId));
    expect(p.version).toBe(version);
  });

  it("descartar no toca las solicitudes", async () => {
    const { planId, version } = await generar();
    valor(await descartarPlan(ctx(), planId, version));
    expect((await bd.select().from(planes))[0]).toMatchObject({ estado: "descartado" });
    expect((await bd.select().from(solicitudes)).every((s) => s.estado === "pendiente" && s.version === 1)).toBe(true);
    expect(valor(await obtenerPlan(ctx(), FECHA_PLAN))).toMatchObject({ estado: "sin_plan", planId: null });
  });

  it("si cambió un cliente desde que se generó, validar responde datos_cambiaron y no escribe nada", async () => {
    const { planId, version } = await generar();
    await bd.update(clientes).set({ version: sql`${clientes.version} + 1` });
    expect(await revisarYValidar(planId, version)).toMatchObject({ ok: false, error: "conflicto", motivo: { codigo: "datos_cambiaron" } });
    expect(await bd.select().from(rutas)).toEqual([]);
    expect((await bd.select().from(solicitudes)).every((s) => s.estado === "pendiente")).toBe(true);
  });

  it("si un cliente retiró su consentimiento, validar responde cliente_no_habilitado", async () => {
    const { planId, version } = await generar();
    const [s] = await bd.select().from(solicitudes).where(eq(solicitudes.id, solicitudIds[1]));
    await bd.transaction((tx) =>
      insertarMovimientoPrivacidad(tx, { clienteId: s.clienteId, versionAviso: "2026-10", accion: "retirado", medio: "papel", registradoPor: despachador.id, en: minutos(1) }),
    );
    expect(await revisarYValidar(planId, version)).toMatchObject({ ok: false, error: "conflicto", motivo: { codigo: "cliente_no_habilitado" } });
  });

  it("si el cliente de una pospuesta retiró su consentimiento, validar tampoco pospone: cliente_no_habilitado", async () => {
    await bd.execute(sql`DELETE FROM jornadas`); // la unidad sigue en el catálogo: todo queda pospuesto, no bloqueado
    const { planId, version } = await generar();
    const [s] = await bd.select().from(solicitudes).where(eq(solicitudes.id, solicitudIds[0]));
    await bd.transaction((tx) =>
      insertarMovimientoPrivacidad(tx, { clienteId: s.clienteId, versionAviso: "2026-10", accion: "retirado", medio: "papel", registradoPor: despachador.id, en: minutos(1) }),
    );
    expect(await revisarYValidar(planId, version)).toMatchObject({ ok: false, error: "conflicto", motivo: { codigo: "cliente_no_habilitado" } });
    expect((await bd.select().from(solicitudes)).every((x) => x.vecesPospuesta === 0)).toBe(true);
  });

  it("si cambió una solicitud que el motor bloqueó por carga, validar responde datos_cambiaron", async () => {
    const c = await clienteHabilitado(bd, "Carga Imposible", 0.02, { cargaEstimadaKg: 20000 });
    const imposible = await solicitudPendiente(bd, c.id, despachador.id, FECHA_PLAN);
    const { planId, version } = await generar();
    expect(valor(await obtenerPlan(ctx(), FECHA_PLAN)).bloqueadas.map((b) => b.solicitudId)).toEqual([imposible]);
    valor(await cancelarSolicitud(ctx(), imposible, 1, "El cliente ya no la necesita"));
    expect(await revisarYValidar(planId, version)).toMatchObject({ ok: false, error: "conflicto", motivo: { codigo: "datos_cambiaron" } });
  });

  it("el mapa usa las ubicaciones de la instantánea del plan, no las actuales del catálogo", async () => {
    await generar();
    const antes = valor(await obtenerPlan(ctx(), FECHA_PLAN));
    await bd.update(clientes).set({ lat: 21.5, lng: -101.5 });
    await bd.execute(sql`UPDATE configuracion SET patio_lat = 21.9, patio_lng = -101.9`);
    const despues = valor(await obtenerPlan(ctx(), FECHA_PLAN));
    expect(despues.patio).toEqual(antes.patio);
    expect(despues.unidades[0].viajes[0].paradas.map((p) => [p.cliente.lat, p.cliente.lng])).toEqual(
      antes.unidades[0].viajes[0].paradas.map((p) => [p.cliente.lat, p.cliente.lng]),
    );
    expect(despues.unidades[0].viajes[0].paradas[0].cliente.lat).not.toBe(21.5);
  });

  it("si cambió la capacidad máxima de la flota, validar responde capacidades_cambiaron", async () => {
    const { planId, version } = await generar();
    valor(await guardarUnidad(ctx(), null, null, unidadDePrueba({ placa: "GRANDE1", capacidadKg: 20000 })));
    expect(await revisarYValidar(planId, version)).toMatchObject({ ok: false, error: "conflicto", motivo: { codigo: "capacidades_cambiaron" } });
  });

  // Tipos torton y tráiler (2026-11-07): una propuesta generada antes del cambio guarda capacidades de solo tres tipos.
  async function comoPropuestaAnterior(planId: string) {
    await bd.execute(sql`UPDATE planes SET entrada = entrada #- '{parametros,capacidadMaximaPorTipoKg,torton}'
      #- '{parametros,capacidadMaximaPorTipoKg,trailer}' WHERE id = ${planId}`);
  }

  it("una propuesta con capacidades de tres tipos detecta que se agregó el primer torton", async () => {
    const { planId, version } = await generar();
    await comoPropuestaAnterior(planId);
    valor(await guardarUnidad(ctx(), null, null, unidadDePrueba({ placa: "TORTON1", tipo: "torton", capacidadKg: 15000 })));
    expect(await revisarYValidar(planId, version)).toMatchObject({ ok: false, error: "conflicto", motivo: { codigo: "capacidades_cambiaron" } });
  });

  it("una propuesta con capacidades de tres tipos se valida si la flota no cambió", async () => {
    const { planId, version } = await generar();
    await comoPropuestaAnterior(planId);
    expect(await revisarYValidar(planId, version)).toMatchObject({ ok: true });
  });

  it("si la hora avanzó y hay salidas en el pasado, pide actualizar horarios; después valida", async () => {
    const { planId, version } = await generar();
    valor(await iniciarRevision(ctx(), planId));
    const tarde = () => new Date("2026-10-15T14:20:00Z"); // 08:20: la salida de las 08:00 ya pasó
    expect(await validarPlanDelDia(ctx(despachador, AHORA_PLAN, tarde), planId, version, { requisitosConfirmados: true })).toMatchObject({
      ok: false, error: "conflicto", motivo: { codigo: "hora_vencida" },
    });
    const v2 = valor(await ajustarPlanDelDia(ctx(despachador, tarde()), planId, version, { tipo: "actualizarHora" })).version;
    const vista = valor(await obtenerPlan(ctx(), FECHA_PLAN));
    expect(vista.unidades[0].viajes[0].salida).toBe("08:30");
    expect(await validarPlanDelDia(ctx(despachador, tarde(), tarde), planId, v2, { requisitosConfirmados: true })).toMatchObject({ ok: true });
  });

  it("actualizar horarios solo aplica al plan de hoy", async () => {
    const { planId, version } = await generar();
    expect(await ajustarPlanDelDia(ctx(despachador, new Date("2026-10-14T20:00:00Z")), planId, version, { tipo: "actualizarHora" })).toMatchObject({
      ok: false, error: "invalido", campos: { _: ["Solo se actualizan los horarios del plan de hoy"] },
    });
  });

  it("sin jornadas, todo queda pospuesto sin unidades y validar solo pospone", async () => {
    await bd.execute(sql`DELETE FROM jornadas`);
    const { planId, version } = await generar();
    const vista = valor(await obtenerPlan(ctx(), FECHA_PLAN));
    expect(vista.pospuestas.map((p) => p.motivo)).toEqual(["sin_unidades_disponibles", "sin_unidades_disponibles", "sin_unidades_disponibles"]);
    expect(await revisarYValidar(planId, version)).toEqual({ ok: true, valor: { programadas: 0, pospuestas: 3 } });
    expect((await bd.select().from(solicitudes)).every((s) => s.proximaFechaElegible === "2026-10-16" && s.vecesPospuesta === 1)).toBe(true);
  });
});
