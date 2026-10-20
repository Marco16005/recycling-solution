import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { asc, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registrarEventoOperador } from "@/acciones/operador.nucleo";
import { generarPlanDelDia, iniciarRevision, validarPlanDelDia } from "@/acciones/plan.nucleo";
import type { Contexto, Resultado } from "@/acciones/tipos";
import { planes, rutas } from "@/datos/esquema";
import {
  AHORA_PLAN, clienteHabilitado, FECHA_PLAN, jornadaDisponible, PATIO, ponerPatio, solicitudPendiente, usuarioOperadorDe,
} from "@/datos/pruebas/escenario-plan";
import { crearBasePostgres, type BasePostgres } from "@/datos/pruebas/postgres-prueba";
import { usuarioDePrueba } from "@/datos/pruebas/usuarios-prueba";
import type { EventoEntrada, TipoEvento } from "@/dominio/operacion/tipos";
import type { UsuarioSesion } from "@/seguridad/permisos";
import { reiniciarCacheDeTrazos, UMBRAL_PIN_M } from "@/traslados";
import { seguimiento } from "./operacion.nucleo";
import { obtenerPlan } from "./plan.nucleo";

// Plan 7, P7-7, con Postgres y OSRM reales (mapa sintético). AHORA_PLAN es 07:00 en Ciudad de México.

function valor<T>(r: Resultado<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.valor;
}
const a = (min: number) => new Date(AHORA_PLAN.getTime() + min * 60_000);

describe("consultas del Plan 7: seguimiento con proyección y plan con calles", () => {
  let base: BasePostgres;
  let despachador: UsuarioSesion;
  let A: { unidadId: string; operadorId: string; jornadaId: string };
  let operadorA: UsuarioSesion;
  const ctx = (usuario: UsuarioSesion, ahora = AHORA_PLAN): Contexto => ({ bd: base.bd, usuario, ahora, reloj: () => ahora });
  const urlOriginal = process.env.OSRM_URL;

  /** Una unidad de 900 kg (una parada de 800 kg por viaje), tres solicitudes y un cliente con el pin lejos de las calles. */
  beforeEach(async () => {
    reiniciarCacheDeTrazos();
    base = await crearBasePostgres();
    despachador = await usuarioDePrueba(base.bd, "despachador");
    await ponerPatio(base.bd);
    A = await jornadaDisponible(base.bd, FECHA_PLAN, "SEGA01", { capacidadKg: 900 });
    operadorA = await usuarioOperadorDe(base.bd, A.operadorId);
    for (const [i, nombre] of ["Norte", "Centro"].entries()) {
      const c = await clienteHabilitado(base.bd, `Cartonera ${nombre}`, 0.01 * (i + 1));
      await solicitudPendiente(base.bd, c.id, despachador.id, FECHA_PLAN, a(-(4 - i)));
    }
    // Zona sin calles del mapa sintético (entre 20.71 y 20.74): su pin queda a más de UMBRAL_PIN_M de una calle.
    const lejano = await clienteHabilitado(base.bd, "Cartonera Lejana", 0, { lat: 20.725, lng: -100.28 });
    await solicitudPendiente(base.bd, lejano.id, despachador.id, FECHA_PLAN, a(-1));
    const { planId } = valor(await generarPlanDelDia(ctx(despachador), FECHA_PLAN));
    valor(await iniciarRevision(ctx(despachador), planId));
    const [p] = await base.bd.select({ version: planes.version }).from(planes).where(eq(planes.id, planId));
    valor(await validarPlanDelDia(ctx(despachador), planId, p.version, { requisitosConfirmados: true }));
  });
  afterEach(async () => {
    process.env.OSRM_URL = urlOriginal;
    await base.cerrar();
  });

  async function operar(tipo: TipoEvento, ocurridoEn: Date, cambios: Partial<EventoEntrada> = {}) {
    const e: EventoEntrada = {
      eventoId: randomUUID(), jornadaId: A.jornadaId, tipo, ocurridoEn: ocurridoEn.toISOString(), rutaId: null, paradaId: null,
      versionRuta: null, odometroKm: null, motivo: null, ...cambios,
    };
    expect(valor(await registrarEventoOperador(ctx(operadorA, ocurridoEn), e)).resultado).toBe("aplicado");
  }
  async function salir(salida: Date) {
    const [primera] = await base.bd.select().from(rutas).where(eq(rutas.jornadaId, A.jornadaId)).orderBy(asc(rutas.salidaEstimada));
    await operar("check_in", new Date(salida.getTime() - 5 * 60_000));
    await operar("salida_patio", salida, { rutaId: primera.id, versionRuta: primera.version, odometroKm: 1000 });
  }
  const jornada = (v: Awaited<ReturnType<typeof seguimiento>>) => valor(v).porJornada.find((j) => j.jornadaId === A.jornadaId)!;

  it("con el reloj y sin eventos nuevos, la alerta de atraso aparece: a las 08:02 no hay, a las 08:45 sí", async () => {
    await salir(a(60)); // 08:00
    const temprano = jornada(await seguimiento(ctx(despachador, a(62)), FECHA_PLAN));
    expect(temprano.proyeccion.alertas).toEqual([]);
    expect(valor(await seguimiento(ctx(despachador, a(62)), FECHA_PLAN)).resumenAlertas).toEqual({ ventana_en_riesgo: 0, fuera_de_turno: 0, atraso: 0 });

    const tarde = await seguimiento(ctx(despachador, a(105)), FECHA_PLAN);
    const j = jornada(tarde);
    const primera = j.proyeccion.paradas.find((p) => p.enViajeEnCurso)!;
    expect(primera.llegadaProyectada).toBe("08:45");
    expect(j.proyeccion.alertas.some((x) => x.tipo === "atraso" && x.enViajeEnCurso)).toBe(true);
    expect(valor(tarde).resumenAlertas.atraso).toBeGreaterThan(0);
    expect(primera.folio).toMatch(/^S-/);
    expect(primera.cliente).toMatch(/^Cartonera/);
    expect(primera.ventana).toEqual({ inicio: "08:00", fin: "14:00" });
  });

  it("liberable: sí en viajes futuros de una jornada disponible, no en el viaje en curso ni tras el check-out", async () => {
    await salir(a(60));
    const j = jornada(await seguimiento(ctx(despachador, a(62)), FECHA_PLAN));
    expect(j.proyeccion.paradas.filter((p) => p.enViajeEnCurso).every((p) => !p.liberable)).toBe(true);
    expect(j.proyeccion.paradas.filter((p) => !p.enViajeEnCurso).length).toBeGreaterThan(0);
    expect(j.proyeccion.paradas.filter((p) => !p.enViajeEnCurso).every((p) => p.liberable)).toBe(true);
    await base.bd.execute(sql`UPDATE jornadas SET check_out_en = ${a(63)} WHERE id = ${A.jornadaId}`);
    const despues = jornada(await seguimiento(ctx(despachador, a(64)), FECHA_PLAN));
    expect(despues.proyeccion.paradas.every((p) => !p.liberable)).toBe(true);
  });

  it("el plan dice con qué tiempos se planeó, lista el pin lejano y dibuja por calle con el mapa del plan", async () => {
    const v = valor(await obtenerPlan(ctx(despachador), FECHA_PLAN));
    expect(v.traslados).toEqual({ fuente: "osrm", motivo: null, mapa: "prueba-cuadricula", paresAproximados: 0 });
    expect(v.pinesARevisar).toHaveLength(1);
    expect(v.pinesARevisar[0].nombre).toBe("Cartonera Lejana");
    expect(v.pinesARevisar[0].distanciaM).toBeGreaterThan(UMBRAL_PIN_M);
    expect(Number.isInteger(v.pinesARevisar[0].distanciaM)).toBe(true);
    const viajes = v.unidades.flatMap((u) => u.viajes);
    expect(viajes.length).toBeGreaterThan(0);
    for (const viaje of viajes) {
      expect(viaje.trazo).toMatchObject({ recto: false, mapa: "prueba-cuadricula", otroMapa: false });
      expect(viaje.trazo.coordenadas[0]).toEqual([expect.closeTo(PATIO.lng, 2), expect.closeTo(PATIO.lat, 2)]);
    }
  });

  it("un plan anterior al Plan 7 no tiene fuente de tiempos ni pins, y un trazo de otro mapa se marca", async () => {
    await base.bd.execute(sql`UPDATE planes SET versiones = versiones - 'traslados', entrada = entrada - 'traslados' WHERE fecha = ${FECHA_PLAN}`);
    const viejo = valor(await obtenerPlan(ctx(despachador), FECHA_PLAN));
    expect(viejo.traslados).toBeNull();
    expect(viejo.pinesARevisar).toEqual([]);
    expect(viejo.unidades.flatMap((u) => u.viajes).every((x) => !x.trazo.otroMapa)).toBe(true);

    await base.bd.execute(sql`UPDATE planes SET versiones = jsonb_set(versiones, '{traslados}',
      '{"fuente":"osrm","motivo":null,"mapa":"mapa-de-antes","paresAproximados":0}') WHERE fecha = ${FECHA_PLAN}`);
    const otro = valor(await obtenerPlan(ctx(despachador), FECHA_PLAN));
    expect(otro.unidades.flatMap((u) => u.viajes).every((x) => x.trazo.otroMapa && x.trazo.mapa === "prueba-cuadricula")).toBe(true);
  });

  it("con OSRM colgado, el plan responde en línea recta sin pasar de unos 3 s", async () => {
    const colgado: Server = createServer(() => { /* nunca responde */ });
    await new Promise<void>((listo) => colgado.listen(0, "127.0.0.1", listo));
    try {
      process.env.OSRM_URL = `http://127.0.0.1:${(colgado.address() as { port: number }).port}`;
      const inicio = performance.now();
      const v = valor(await obtenerPlan(ctx(despachador), FECHA_PLAN));
      expect(performance.now() - inicio).toBeLessThan(3500);
      expect(v.unidades.flatMap((u) => u.viajes).every((x) => x.trazo.recto && x.trazo.mapa === null)).toBe(true);
    } finally {
      colgado.closeAllConnections();
      colgado.close();
    }
  });
});
