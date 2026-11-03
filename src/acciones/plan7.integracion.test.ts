import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { asc, desc, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configuracion, ejecucionesMotor, paradas, planes, rutas } from "@/datos/esquema";
import type { PlanGuardado } from "@/datos/planes";
import {
  AHORA_PLAN, clienteHabilitado, FECHA_PLAN, jornadaDisponible, ponerPatio, solicitudPendiente, usuarioOperadorDe,
} from "@/datos/pruebas/escenario-plan";
import { crearBasePostgres, type BasePostgres } from "@/datos/pruebas/postgres-prueba";
import { usuarioDePrueba } from "@/datos/pruebas/usuarios-prueba";
import type { EventoEntrada, TiemposRuta, TipoEvento } from "@/dominio/operacion/tipos";
import type { EntradaPlan } from "@/motor";
import type { UsuarioSesion } from "@/seguridad/permisos";
import { estadoDeJornada, leerJornadaOperacion } from "@/datos/operacion";
import { registrarEventoOperador } from "./operador.nucleo";
import { generarPlanDelDia, iniciarRevision, validarPlanDelDia } from "./plan.nucleo";
import { generarReruteo } from "./reruteo.nucleo";
import type { Contexto, Resultado } from "./tipos";

// Plan 7, P7-6, con Postgres y OSRM reales (mapa sintético). AHORA_PLAN es 07:00 en Ciudad de México.

function valor<T>(r: Resultado<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.valor;
}
const a = (min: number) => new Date(AHORA_PLAN.getTime() + min * 60_000);

describe("acciones del Plan 7 con calles reales", () => {
  let base: BasePostgres;
  let despachador: UsuarioSesion;
  let A: { unidadId: string; operadorId: string; jornadaId: string };
  let B: { unidadId: string; operadorId: string; jornadaId: string };
  let solicitudes: string[];
  const ctx = (usuario: UsuarioSesion, ahora = AHORA_PLAN): Contexto => ({ bd: base.bd, usuario, ahora, reloj: () => ahora });
  const urlOriginal = process.env.OSRM_URL;

  /** Dos unidades de 900 kg (una parada de 800 kg por viaje) y cuatro solicitudes cerca del patio. */
  beforeEach(async () => {
    base = await crearBasePostgres();
    despachador = await usuarioDePrueba(base.bd, "despachador");
    await ponerPatio(base.bd);
    A = await jornadaDisponible(base.bd, FECHA_PLAN, "CALA01", { capacidadKg: 900 });
    B = await jornadaDisponible(base.bd, FECHA_PLAN, "CALB02", { capacidadKg: 900 });
    solicitudes = [];
    for (const [i, nombre] of ["Norte", "Centro", "Sur", "Oriente"].entries()) {
      const c = await clienteHabilitado(base.bd, `Cartonera ${nombre}`, 0.01 * (i + 1));
      solicitudes.push(await solicitudPendiente(base.bd, c.id, despachador.id, FECHA_PLAN, a(-(4 - i))));
    }
  });
  afterEach(async () => {
    process.env.OSRM_URL = urlOriginal;
    operadores.clear();
    await base.cerrar();
  });

  const plan = async (id: string) => (await base.bd.select().from(planes).where(eq(planes.id, id)))[0] as unknown as PlanGuardado & { versionMotor: string };
  async function validar(id: string, ahora = AHORA_PLAN) {
    valor(await iniciarRevision(ctx(despachador, ahora), id));
    return validarPlanDelDia(ctx(despachador, ahora), id, (await plan(id)).version, { requisitosConfirmados: true });
  }
  async function generarYValidar() {
    const { planId } = valor(await generarPlanDelDia(ctx(despachador), FECHA_PLAN));
    valor(await validar(planId));
    return planId;
  }
  const rutasDe = (jornadaId: string) => base.bd.select().from(rutas).where(eq(rutas.jornadaId, jornadaId)).orderBy(asc(rutas.salidaEstimada));
  const paradasDe = (rutaId: string) => base.bd.select().from(paradas).where(eq(paradas.rutaId, rutaId)).orderBy(asc(paradas.secuencia));

  const operadores = new Map<string, UsuarioSesion>();
  async function operar(jornada: typeof A, tipo: TipoEvento, ocurridoEn: Date, cambios: Partial<EventoEntrada> = {}) {
    if (!operadores.has(jornada.jornadaId)) operadores.set(jornada.jornadaId, await usuarioOperadorDe(base.bd, jornada.operadorId));
    const operador = operadores.get(jornada.jornadaId)!;
    const e: EventoEntrada = {
      eventoId: randomUUID(), jornadaId: jornada.jornadaId, tipo, ocurridoEn: ocurridoEn.toISOString(), rutaId: null, paradaId: null,
      versionRuta: null, odometroKm: null, motivo: null, ...cambios,
    };
    const r = valor(await registrarEventoOperador(ctx(operador, ocurridoEn), e));
    expect(r.resultado).toBe("aplicado");
  }
  /** check-in y salida del patio del primer viaje de la jornada. */
  async function salirConElPrimerViaje(jornada: typeof A, salida: Date) {
    const [primera] = await rutasDe(jornada.jornadaId);
    await operar(jornada, "check_in", new Date(salida.getTime() - 5 * 60_000));
    await operar(jornada, "salida_patio", salida, { rutaId: primera.id, versionRuta: primera.version, odometroKm: 1000 });
    return primera;
  }

  it("generar consulta OSRM: la entrada guarda la matriz, versiones dice osrm con su mapa y K7 guarda consulta_mapa_ms", async () => {
    const { planId } = valor(await generarPlanDelDia(ctx(despachador), FECHA_PLAN));
    const p = await plan(planId);
    expect(p.versionMotor).toBe("1.2.0");
    expect(p.versiones.traslados).toEqual({ fuente: "osrm", motivo: null, mapa: "prueba-cuadricula", paresAproximados: 0 });
    // Patio y cuatro clientes; las unidades salen del patio.
    expect(p.entrada.traslados!.puntos).toHaveLength(5);
    expect(p.entrada.parametros.horasPico).toEqual([{ inicioMin: 420, finMin: 570, factor: 1.3 }, { inicioMin: 810, finMin: 900, factor: 1.15 }]);
    const [e] = await base.bd.select().from(ejecucionesMotor).orderBy(desc(ejecucionesMotor.inicioEn)).limit(1);
    expect(e.planId).toBe(planId);
    expect(e.consultaMapaMs).toBeGreaterThan(0);
  });

  it("con OSRM que no responde, el plan sale con la fórmula (sin_respuesta) en unos 5 s y K7 se registra igual", async () => {
    const colgado: Server = createServer(() => { /* nunca responde */ });
    await new Promise<void>((listo) => colgado.listen(0, "127.0.0.1", listo));
    try {
      const { port } = colgado.address() as { port: number };
      process.env.OSRM_URL = `http://127.0.0.1:${port}`;
      const inicio = performance.now();
      const { planId } = valor(await generarPlanDelDia(ctx(despachador), FECHA_PLAN));
      expect(performance.now() - inicio).toBeLessThan(8000);
      const p = await plan(planId);
      expect(p.versiones.traslados).toEqual({ fuente: "aproximado", motivo: "sin_respuesta", mapa: null, paresAproximados: 0 });
      expect(p.entrada.traslados).toBeUndefined();
      const [e] = await base.bd.select().from(ejecucionesMotor).orderBy(desc(ejecucionesMotor.inicioEn)).limit(1);
      expect(e.consultaMapaMs).toBeGreaterThanOrEqual(4900);
    } finally {
      colgado.closeAllConnections();
      colgado.close();
    }
  }, 20_000);

  it("un plan 1.0.0 guardado antes del Plan 7 (sin matriz ni horas pico) se valida y conserva su versión", async () => {
    process.env.OSRM_URL = "";
    await base.bd.update(configuracion).set({ horasPico: [], version: sql`${configuracion.version} + 1` }).where(eq(configuracion.id, 1));
    const { planId } = valor(await generarPlanDelDia(ctx(despachador), FECHA_PLAN));
    await base.bd.execute(sql`
      UPDATE planes SET version_motor = '1.0.0',
        resultado = jsonb_set(jsonb_set(resultado - 'reacomodo', '{versionMotor}', '"1.0.0"'), '{resumen}', (resultado->'resumen') - 'tiempoMuertoMin'),
        entrada = entrada #- '{parametros,horasPico}',
        versiones = versiones - 'traslados'
      WHERE id = ${planId}`);
    valor(await validar(planId));
    const p = await plan(planId);
    expect(p.estado).toBe("validado");
    expect(p.versionMotor).toBe("1.0.0");
    const [r] = await rutasDe(A.jornadaId);
    expect((r.tiempos as TiemposRuta).horasPico).toEqual([]);
  });

  it("validar guarda por ruta su modelo de tiempos y el contrafactual sale de la matriz en ambos sentidos", async () => {
    const planId = await generarYValidar();
    const p = await plan(planId);
    const m = p.entrada.traslados!;
    const fila = (c: { lat: number; lng: number }) => m.puntos.findIndex((x) => x.lat === c.lat && x.lng === c.lng);
    const patio = fila(p.entrada.parametros.patio);
    const ubicacion = new Map(p.entrada.solicitudes.map((s) => [s.id, s.ubicacion]));
    const todas = [...(await rutasDe(A.jornadaId)), ...(await rutasDe(B.jornadaId))];
    expect(todas.length).toBeGreaterThan(0);
    for (const r of todas) {
      const t = r.tiempos as TiemposRuta;
      const suyas = await paradasDe(r.id);
      expect(t.puntos).toEqual(["patio", ...suyas.map((x) => x.solicitudId)]);
      expect(t.horasPico).toEqual(p.entrada.parametros.horasPico);
      expect(t.turnoFinMin).toBe(p.entrada.parametros.turnoFinMin);
      expect(t.descargaMin).toBe(p.entrada.parametros.descargaMin);
      for (const x of suyas) {
        const c = fila(ubicacion.get(x.solicitudId)!);
        expect(x.kmContrafactual).toBeCloseTo(m.km[patio][c] + m.km[c][patio], 9);
        expect(t.minLibres[0][t.puntos.indexOf(x.solicitudId)]).toBeCloseTo(m.minLibres[patio][c], 9);
      }
    }
  });

  it("liberar una parada de un viaje futuro la reubica y queda en las restricciones; una del viaje en curso es invalido", async () => {
    await generarYValidar();
    const [primera, segunda] = await rutasDe(A.jornadaId);
    expect(segunda).toBeDefined();
    await salirConElPrimerViaje(A, a(60));
    const [enCurso] = await paradasDe(primera.id);
    const [futura] = await paradasDe(segunda.id);
    const [base0] = await base.bd.select().from(planes).where(eq(planes.estado, "validado"));

    const mal = await generarReruteo(ctx(despachador, a(65)), base0.id, base0.version, { jornadasNoDisponibles: [], liberadas: [enCurso.solicitudId] });
    expect(mal).toMatchObject({ ok: false, error: "invalido" });

    const { planId } = valor(await generarReruteo(ctx(despachador, a(65)), base0.id, base0.version, { jornadasNoDisponibles: [], liberadas: [futura.solicitudId] }));
    const r = await plan(planId);
    expect(r.restricciones!.liberadas).toEqual([futura.solicitudId]);
    expect(Object.values(r.restricciones!.admitidas).flat(2)).not.toContain(futura.solicitudId);
    const ruteadas = r.resultado.rutas.flatMap((x) => x.viajes.flatMap((v) => v.paradas.map((y) => y.solicitudId)));
    const pospuestas = r.resultado.pospuestas.map((x) => x.solicitudId);
    expect([...ruteadas, ...pospuestas]).toContain(futura.solicitudId);
    expect(r.versiones.traslados?.fuente).toBe("osrm");
  });

  it("re-ruteo encadenado: se libera una parada que sigue como reasignada en la ruta iniciada de otra jornada", async () => {
    await generarYValidar();
    // B sale del patio y se descompone: su ruta queda iniciada (en su secuencia operativa) con las paradas retiradas.
    await salirConElPrimerViaje(B, a(60));
    const [base0] = await base.bd.select().from(planes).where(eq(planes.estado, "validado"));
    const { planId: r1 } = valor(await generarReruteo(ctx(despachador, a(65)), base0.id, base0.version, { jornadasNoDisponibles: [B.jornadaId] }));
    valor(await validar(r1, a(65)));
    const estadoB = await estadoDeJornada(base.bd, (await leerJornadaOperacion(base.bd, B.jornadaId))!);
    const historica = estadoB.viajes.flatMap((v) => v.paradas).find((p) => !p.vigente && p.estado === "reasignada");
    expect(historica).toBeDefined();
    const movida = historica!.solicitudId;
    const estadoA = await estadoDeJornada(base.bd, (await leerJornadaOperacion(base.bd, A.jornadaId))!);
    expect(estadoA.viajes.flatMap((v) => v.paradas).some((p) => p.vigente && p.estado === "pendiente" && p.solicitudId === movida)).toBe(true);

    // 2: se libera esa solicitud; la jornada vieja (B) no la reclama y el re-ruteo se genera y se valida.
    const [vigente] = await base.bd.select().from(planes).where(eq(planes.estado, "validado"));
    const { planId: r2 } = valor(await generarReruteo(ctx(despachador, a(70)), vigente.id, vigente.version,
      { jornadasNoDisponibles: [B.jornadaId], liberadas: [movida] }));
    expect((await plan(r2)).restricciones!.liberadas).toEqual([movida]);
    valor(await validar(r2, a(70)));
  });

  it("frontera_vencida: la unidad no registra su llegada y, al validar, su viaje en curso termina después de la salida propuesta", async () => {
    await generarYValidar();
    await salirConElPrimerViaje(A, a(60)); // 08:00
    const [base0] = await base.bd.select().from(planes).where(eq(planes.estado, "validado"));
    // B deja de estar disponible: lo suyo pasa a A después de su viaje en curso (frontera proyectada a las 08:05).
    const { planId } = valor(await generarReruteo(ctx(despachador, a(65)), base0.id, base0.version, { jornadasNoDisponibles: [B.jornadaId] }));
    valor(await iniciarRevision(ctx(despachador, a(65)), planId));
    const p = await plan(planId);
    const salidaA = p.resultado.rutas.find((x) => x.unidadId === A.jornadaId)!.viajes[0].salidaMin;
    // Sin eventos, a las 08:50 la primera llegada de A ya va tarde: su fin de descarga proyectado se mueve más allá de salidaA.
    const r = await validarPlanDelDia(ctx(despachador, a(110)), planId, p.version, { requisitosConfirmados: true });
    expect(salidaA).toBeGreaterThan(530);
    expect(r).toMatchObject({ ok: false, error: "conflicto", motivo: { codigo: "frontera_vencida" } });
  });

  it("las propuestas de re-ruteo guardan la matriz del momento y K7 su consulta", async () => {
    await generarYValidar();
    const [base0] = await base.bd.select().from(planes).where(eq(planes.estado, "validado"));
    const { planId } = valor(await generarReruteo(ctx(despachador, a(10)), base0.id, base0.version, { jornadasNoDisponibles: [B.jornadaId] }));
    const p = await plan(planId);
    expect((p.entrada as EntradaPlan).traslados?.mapa).toBe("prueba-cuadricula");
    const [e] = await base.bd.select().from(ejecucionesMotor).orderBy(desc(ejecucionesMotor.inicioEn)).limit(1);
    expect(e.consultaMapaMs).toBeGreaterThan(0);
  });
});
