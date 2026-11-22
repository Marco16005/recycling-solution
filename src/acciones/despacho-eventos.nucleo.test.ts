import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { pospuestasDelDia, seguimiento, type SeguimientoJornada } from "@/consultas/operacion.nucleo";
import type { BD } from "@/datos/bd";
import { bitacora, eventosOperador, planes, rutas } from "@/datos/esquema";
import { crearBdPrueba } from "@/datos/pruebas/bd-prueba";
import {
  AHORA_PLAN, clienteHabilitado, FECHA_PLAN, jornadaDisponible, ponerPatio, solicitudPendiente, usuarioOperadorDe,
} from "@/datos/pruebas/escenario-plan";
import { usuarioDePrueba } from "@/datos/pruebas/usuarios-prueba";
import type { EventoEntrada, TipoEvento } from "@/dominio/operacion/tipos";
import type { UsuarioSesion } from "@/seguridad/permisos";
import { registrarEventoOperador, registrarEventoPorDespacho } from "./operador.nucleo";
import { generarPlanDelDia, iniciarRevision, validarPlanDelDia } from "./plan.nucleo";
import { generarReruteo } from "./reruteo.nucleo";
import type { Contexto, Resultado } from "./tipos";

function valor<T>(r: Resultado<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.valor;
}
/** Minutos después de las 07:00 de Ciudad de México del jueves del plan. */
const a = (min: number) => new Date(AHORA_PLAN.getTime() + min * 60_000);

describe("tablero del día: el despacho marca el avance (2026-11-21)", () => {
  let bd: BD;
  let despachador: UsuarioSesion;
  let jornada: { unidadId: string; operadorId: string; jornadaId: string };
  const ctx = (usuario: UsuarioSesion, ahora = AHORA_PLAN): Contexto => ({ bd, usuario, ahora, reloj: () => ahora });

  /** Plan validado de hoy: un camión con dos recolecciones en un viaje. */
  beforeEach(async () => {
    bd = await crearBdPrueba();
    despachador = await usuarioDePrueba(bd, "despachador");
    await ponerPatio(bd);
    jornada = await jornadaDisponible(bd, FECHA_PLAN, "TAB001");
    for (const [i, nombre] of ["Norte", "Sur"].entries()) {
      const c = await clienteHabilitado(bd, `Cartonera ${nombre}`, 0.01 * (i + 1));
      await solicitudPendiente(bd, c.id, despachador.id, FECHA_PLAN, new Date(AHORA_PLAN.getTime() - (2 - i) * 60_000));
    }
    const { planId } = valor(await generarPlanDelDia(ctx(despachador), FECHA_PLAN));
    valor(await iniciarRevision(ctx(despachador), planId));
    const [p] = await bd.select({ version: planes.version }).from(planes).where(eq(planes.id, planId));
    valor(await validarPlanDelDia(ctx(despachador), planId, p.version, { requisitosConfirmados: true }));
  });

  async function tablero(usuario = despachador, ahora = AHORA_PLAN): Promise<SeguimientoJornada["tablero"]> {
    const vista = valor(await seguimiento(ctx(usuario, ahora), FECHA_PLAN));
    return vista.porJornada.find((j) => j.jornadaId === jornada.jornadaId)!.tablero;
  }

  /** El siguiente paso que ofrece el tablero, convertido en evento a la hora dada. */
  async function siguiente(ocurridoEn: Date, cambios: Partial<EventoEntrada> = {}): Promise<EventoEntrada> {
    const paso = (await tablero(despachador, ocurridoEn)).siguiente!;
    return {
      eventoId: randomUUID(), jornadaId: jornada.jornadaId, tipo: paso.tipo, ocurridoEn: ocurridoEn.toISOString(),
      rutaId: paso.rutaId, paradaId: paso.paradaId, versionRuta: paso.versionRuta, odometroKm: null, motivo: null, ...cambios,
    };
  }
  const marcar = (e: EventoEntrada, ahora = new Date(e.ocurridoEn)) => registrarEventoPorDespacho(ctx(despachador, ahora), e);

  it("antes de llegar: frase, viaje en espera, recolecciones pendientes y el primer paso", async () => {
    const t = await tablero();
    expect(t.frase).toBe("Sin llegar al patio");
    expect(t.recolecciones).toEqual({ hechas: 0, total: 2 });
    expect(t.viajes).toHaveLength(1);
    expect(t.viajes[0]).toMatchObject({ numero: 1, estado: "en_espera", etiqueta: "En espera", salida: null, regreso: null });
    // El orden lo decide el motor; aquí solo importa que ambas estén pendientes.
    expect(t.viajes[0].paradas.map((p) => p.cliente).sort()).toEqual(["Cartonera Norte", "Cartonera Sur"]);
    expect(t.viajes[0].paradas.map((p) => [p.estado, p.etiqueta])).toEqual([["pendiente", "Pendiente"], ["pendiente", "Pendiente"]]);
    expect(t.siguiente).toMatchObject({ tipo: "check_in", texto: "Llegó al patio", pideOdometro: false, desde: null });
  });

  it("el despacho marca un viaje completo sin odómetro y el tablero cuenta cada paso", async () => {
    const [primera, segunda] = (await tablero()).viajes[0].paradas.map((p) => p.cliente);
    valor(await marcar(await siguiente(a(50))));
    expect((await tablero(despachador, a(51))).frase).toBe("En el patio, sin salir");

    const salida = await siguiente(a(60));
    expect((await tablero(despachador, a(60))).siguiente).toMatchObject({ texto: "Salió del patio (viaje 1)", pideOdometro: true });
    expect(valor(await marcar(salida)).resultado).toBe("aplicado");
    const [ruta] = await bd.select({ km: rutas.odometroInicioKm }).from(rutas).where(eq(rutas.id, salida.rutaId!));
    expect(ruta.km).toBeNull();
    let t = await tablero(despachador, a(61));
    expect(t.frase).toBe(`Viaje 1: en camino a ${primera}`);
    expect(t.viajes[0]).toMatchObject({ estado: "en_camino", salida: "08:00" });
    expect(t.viajes[0].paradas[0].estado).toBe("en_camino");

    valor(await marcar(await siguiente(a(70))));
    expect((await tablero(despachador, a(71))).frase).toBe(`Viaje 1: en ${primera}, esperando`);
    valor(await marcar(await siguiente(a(72))));
    expect((await tablero(despachador, a(73))).frase).toBe(`Viaje 1: recolectando en ${primera}`);
    valor(await marcar(await siguiente(a(90))));
    t = await tablero(despachador, a(91));
    expect(t.viajes[0].paradas[0]).toMatchObject({ estado: "recolectada", etiqueta: "Recolectada", hora: "08:30" });
    expect(t.recolecciones).toEqual({ hechas: 1, total: 2 });
    expect(t.frase).toBe(`Viaje 1: en camino a ${segunda}`);
  });

  it("no se pudo atender: queda con su motivo y la siguiente pasa a en camino", async () => {
    valor(await marcar(await siguiente(a(50))));
    valor(await marcar(await siguiente(a(60), { odometroKm: 1000 })));
    valor(await marcar(await siguiente(a(70))));
    const paso = (await tablero(despachador, a(75))).siguiente!;
    expect(paso.permiteNoAtendida).toBe(true);
    // A las 08:15:30: el tablero muestra 08:15 (al minuto hacia abajo), no 08:16.
    const cierre = new Date(a(75).getTime() + 30_000);
    valor(await marcar(await siguiente(cierre, { tipo: "no_atendida", motivo: "Cliente cerrado" })));
    const t = await tablero(despachador, a(76));
    expect(t.viajes[0].paradas[0]).toMatchObject({ estado: "no_atendida", etiqueta: "No se pudo atender", motivo: "Cliente cerrado", hora: "08:15" });
    expect(t.viajes[0].paradas[1]).toMatchObject({ estado: "en_camino" });
    expect(t.viajes[0].paradas[1].horaPlan).toMatch(/^\d{2}:\d{2}$/);
    expect(t.viajes[0].paradas[0].horaPlan).toBeNull();
  });

  it("deja rastro: el evento es del despachador y la bitácora dice por_despacho", async () => {
    const e = await siguiente(a(50));
    valor(await marcar(e));
    const [fila] = await bd.select({ usuarioId: eventosOperador.usuarioId, resultado: eventosOperador.resultado })
      .from(eventosOperador).where(eq(eventosOperador.eventoId, e.eventoId));
    expect(fila).toEqual({ usuarioId: despachador.id, resultado: "aplicado" });
    const [registro] = await bd.select({ accion: bitacora.accion }).from(bitacora)
      .where(and(eq(bitacora.entidadId, jornada.jornadaId), eq(bitacora.usuarioId, despachador.id)));
    expect(registro.accion).toBe("evento_check_in_por_despacho");
  });

  it("hora: ni futura, ni de otro día, ni anterior a la última marca", async () => {
    const futura = await siguiente(a(50));
    expect(await marcar(futura, a(40))).toEqual({ ok: false, error: "invalido", campos: { ocurridoEn: ["La hora no puede ser futura"] } });
    expect(await marcar({ ...futura, ocurridoEn: new Date(AHORA_PLAN.getTime() - 24 * 3_600_000).toISOString() }, a(50)))
      .toEqual({ ok: false, error: "invalido", campos: { ocurridoEn: ["La hora debe ser del día de la jornada"] } });
    valor(await marcar(futura, a(51)));
    const antes = await siguiente(a(55));
    expect(await marcar({ ...antes, ocurridoEn: a(45).toISOString() }, a(56)))
      .toEqual({ ok: false, error: "invalido", campos: { ocurridoEn: ["La hora no puede ser anterior a la última marca de este camión"] } });
    expect((await tablero(despachador, a(56))).siguiente?.desde).toBe("07:50");
  });

  it("un paso fuera de orden se rechaza con su motivo y no se guarda nada", async () => {
    const e = await siguiente(a(50), { tipo: "fin_descarga" });
    const r = await marcar(e);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error === "invalido") expect(r.campos._?.[0]).toBeTruthy();
    expect(await bd.select().from(eventosOperador).where(eq(eventosOperador.eventoId, e.eventoId))).toHaveLength(0);
  });

  it("reintentar la misma marca no la duplica", async () => {
    const e = await siguiente(a(50));
    valor(await marcar(e));
    expect(valor(await marcar(e))).toMatchObject({ resultado: "aplicado", repetido: true });
    expect(await bd.select().from(eventosOperador).where(eq(eventosOperador.jornadaId, jornada.jornadaId))).toHaveLength(1);
  });

  it("un re-ruteo que pospone todo un viaje que no salió: el tablero lista las pospuestas (revisión de Codex)", async () => {
    const [base] = await bd.select().from(planes).where(eq(planes.estado, "validado"));
    // Sin otro camión, las recolecciones del único quedan pospuestas para otro día.
    const { planId } = valor(await generarReruteo(ctx(despachador, a(30)), base.id, base.version, { jornadasNoDisponibles: [jornada.jornadaId] }));
    valor(await iniciarRevision(ctx(despachador, a(31)), planId));
    const [p] = await bd.select().from(planes).where(eq(planes.id, planId));
    valor(await validarPlanDelDia(ctx(despachador, a(32)), planId, p.version, { requisitosConfirmados: true }));
    const t = await tablero(despachador, a(33));
    expect(t.viajes).toHaveLength(0);
    expect(t.recolecciones).toEqual({ hechas: 0, total: 0 });
    expect(t.omitidas.map((o) => o.cliente).sort()).toEqual(["Cartonera Norte", "Cartonera Sur"]);
    expect(t.omitidas.every((o) => /^S-/.test(o.folio))).toBe(true);
  });

  it("permisos: gerencia ve el tablero sin siguiente paso y no marca; el operador tampoco marca por despacho", async () => {
    const gerencia = await usuarioDePrueba(bd, "gerencia");
    const vista = valor(await seguimiento(ctx(gerencia), FECHA_PLAN));
    expect(vista.puedeRegistrar).toBe(false);
    expect(vista.porJornada[0].tablero.siguiente).toBeNull();
    const e = await siguiente(a(50));
    expect(await registrarEventoPorDespacho(ctx(gerencia, a(50)), e)).toEqual({ ok: false, error: "no_autorizado" });
    const operador = await usuarioOperadorDe(bd, jornada.operadorId);
    expect(await registrarEventoPorDespacho(ctx(operador, a(50)), e)).toEqual({ ok: false, error: "no_autorizado" });
    expect(valor(await seguimiento(ctx(despachador), FECHA_PLAN)).puedeRegistrar).toBe(true);
  });

  it("desde el teléfono, salir del patio sigue pidiendo el odómetro", async () => {
    const operador = await usuarioOperadorDe(bd, jornada.operadorId);
    const llegada = await siguiente(a(50));
    valor(await registrarEventoOperador(ctx(operador, a(50)), llegada));
    const salida = await siguiente(a(60));
    expect(salida.tipo satisfies TipoEvento).toBe("salida_patio");
    expect(await registrarEventoOperador(ctx(operador, a(60)), salida)).toEqual({ ok: false, error: "invalido", campos: { odometroKm: ["Captura el odómetro"] } });
    expect(valor(await registrarEventoOperador(ctx(operador, a(60)), { ...salida, odometroKm: 1200 })).resultado).toBe("aplicado");
  });
});

describe("pospuestas por re-ruteo en el tablero (revisiones de Codex del cabd8e8 y del ceab474)", () => {
  const o = (paradaId: string, solicitudId: string, minuto: number) => ({ paradaId, solicitudId, en: a(minuto).toISOString() });

  it("una vez en todo el día, en el camión donde se pospuso por última vez, y nunca si volvió a quedar activa", () => {
    const porJornada = [
      // Camión A: S1 se pospuso y luego volvió a un viaje (activa); S2 se pospuso a las 07:10; S3 dos veces en A.
      { jornadaId: "A", omitidas: [o("a1", "S1", 5), o("a2", "S2", 10), o("a3", "S3", 15), o("a4", "S3", 20)] },
      // Camión B: S2 se reprogramó, se asignó a B y se pospuso otra vez a las 07:40.
      { jornadaId: "B", omitidas: [o("b1", "S2", 40)] },
    ];
    const r = pospuestasDelDia(porJornada, new Set(["S1"]));
    expect(r.get("A")!.map((x) => x.paradaId)).toEqual(["a4"]);
    expect(r.get("B")!.map((x) => x.paradaId)).toEqual(["b1"]);
    const todas = [...r.values()].flat().map((x) => x.solicitudId);
    expect(new Set(todas).size).toBe(todas.length);
  });
});
