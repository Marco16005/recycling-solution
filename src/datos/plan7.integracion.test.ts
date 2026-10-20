import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TiemposRuta } from "@/dominio/operacion";
import { insertarCliente } from "./clientes";
import { leerConfiguracionCompleta } from "./configuracion";
import { insertarOperador, insertarUnidad } from "./flota";
import { insertarJornada } from "./jornadas";
import { estadoDeJornada, leerJornadaOperacion } from "./operacion";
import { insertarEjecucion, insertarRutas, leerPlan, type NuevaRuta } from "./planes";
import { clienteDePrueba } from "./pruebas/datos-ejemplo";
import { operadorDePrueba, unidadDePrueba } from "./pruebas/flota-ejemplo";
import { crearBasePostgres, filasDe, type BasePostgres } from "./pruebas/postgres-prueba";
import { usuarioDePrueba } from "./pruebas/usuarios-prueba";
import { insertarSolicitud } from "./solicitudes";

const AHORA = new Date("2026-10-15T14:00:00Z");

async function errorDe(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (error) {
    const causa = (error as { cause?: { message?: string } }).cause;
    return causa?.message ?? String(error);
  }
  return "sin error";
}

describe("modelo del Plan 7 con Postgres real (migración 0008)", () => {
  let base: BasePostgres;
  let usuarioId: string;
  let jornadaId: string;
  let solicitudes: string[];

  beforeAll(async () => {
    base = await crearBasePostgres();
    usuarioId = (await usuarioDePrueba(base.bd, "despachador")).id;
    const clienteId = (await base.bd.transaction((tx) => insertarCliente(tx, clienteDePrueba(), AHORA))).id;
    solicitudes = [];
    for (const n of [1, 2]) {
      solicitudes.push(await base.bd.transaction((tx) =>
        insertarSolicitud(tx, {
          folio: `S-20261015-00${n}`, clienteId, registradaEn: AHORA, registradaPor: usuarioId, fechaSolicitada: "2026-10-15",
          canal: "telefono", cargaEstimadaKg: null, notas: null, capturaInicioEn: null, capturaFinEn: AHORA,
        }),
      ));
    }
    const unidad = await base.bd.transaction((tx) => insertarUnidad(tx, unidadDePrueba(), AHORA));
    const operador = await base.bd.transaction((tx) => insertarOperador(tx, operadorDePrueba(), AHORA));
    jornadaId = await base.bd.transaction((tx) =>
      insertarJornada(tx, { fecha: "2026-10-15", unidadId: unidad.id, operadorId: operador.id, disponibleDesde: "08:00", notas: null }, AHORA),
    );
  });
  afterAll(async () => base.cerrar());

  async function planValidado(restricciones: unknown = null, fecha = "2026-10-15"): Promise<string> {
    const filas = await base.bd.execute(sql`
      INSERT INTO planes (fecha, estado, generado_en, generado_por, semilla, version_motor, entrada, versiones, resultado,
                          revision_iniciada_en, validado_en, validado_por, requisitos_confirmados_en, restricciones)
      VALUES (${fecha}, 'validado', now(), ${usuarioId}, 20261015, '1.1.0', '{}', '{}', '{}',
              ${AHORA}, ${AHORA}, ${usuarioId}, ${AHORA}, ${restricciones === null ? null : JSON.stringify(restricciones)}::jsonb)
      RETURNING id`);
    return filasDe<{ id: string }>(filas)[0].id;
  }

  function ruta(tiempos: TiemposRuta | null, numeroViaje: number, solicitudId: string): NuevaRuta {
    // Cada viaje sale tres horas después del anterior: la secuencia operativa ordena por salida estimada.
    const h = (hhmm: string) => new Date(Date.parse(`2026-10-15T${hhmm}:00-06:00`) + (numeroViaje - 1) * 3 * 3_600_000);
    return {
      jornadaId, numeroViaje, salidaEstimada: h("08:00"), regresoEstimado: h("09:45"), finDescargaEstimado: h("10:05"),
      cargaKg: 800, kmEstimados: 12, kmContrafactual: 20, rendimientoKmLUsado: 3, disponibleParaSalirEn: h("08:00"), asignadaEn: AHORA,
      tiempos,
      paradas: [{
        solicitudId, secuencia: 1, ventanaInicio: "08:00", ventanaFin: "09:00", llegadaEstimada: h("08:20"),
        inicioEstimado: h("08:20"), finEstimado: h("08:40"), esperaMin: 0, cargaKg: 800, kmDesdeAnterior: 6, kmContrafactual: 12,
      }],
    };
  }

  it("la configuración trae los valores iniciales del Plan 7 y sus CHECK los defienden", async () => {
    const c = await leerConfiguracionCompleta(base.bd);
    expect(c.factorCamion).toBe(1.2);
    expect(c.horasPico).toEqual([{ inicio: "07:00", fin: "09:30", factor: 1.3 }, { inicio: "13:30", fin: "15:00", factor: 1.15 }]);
    expect(c.umbralAtrasoMin).toBe(15);
    expect(await errorDe(base.bd.execute(sql`UPDATE configuracion SET factor_camion = 0.9`))).toMatch(/configuracion_factor_camion/);
    expect(await errorDe(base.bd.execute(sql`UPDATE configuracion SET factor_camion = 3.1`))).toMatch(/configuracion_factor_camion/);
    expect(await errorDe(base.bd.execute(sql`UPDATE configuracion SET umbral_atraso_min = 0`))).toMatch(/configuracion_umbral_atraso/);
    expect(await errorDe(base.bd.execute(sql`UPDATE configuracion SET horas_pico = '{}'::jsonb`))).toMatch(/configuracion_horas_pico/);
  });

  it("una ruta guarda y devuelve su modelo de tiempos, y una sin modelo queda en null", async () => {
    const tiempos: TiemposRuta = {
      puntos: ["patio", solicitudes[0]], minLibres: [[0, 20.5], [22, 0]],
      horasPico: [{ inicioMin: 420, finMin: 570, factor: 1.3 }], turnoFinMin: 960, descargaMin: 20,
    };
    const planId = await planValidado();
    await base.bd.transaction((tx) => insertarRutas(tx, planId, [ruta(tiempos, 1, solicitudes[0]), ruta(null, 2, solicitudes[1])], AHORA));
    const jornada = (await leerJornadaOperacion(base.bd, jornadaId))!;
    const estado = await estadoDeJornada(base.bd, jornada);
    expect(estado.viajes.map((v) => v.tiempos)).toEqual([tiempos, null]);
    expect(estado.viajes[0].paradas[0]).toMatchObject({ ventanaInicio: "08:00", ventanaFin: "09:00" });
  });

  it("las restricciones de un re-ruteo guardan liberadas, y las de antes se leen sin ellas", async () => {
    const planBase = await planValidado(null, "2026-10-16");
    const reruteo = async (restricciones: unknown) => filasDe<{ id: string }>(await base.bd.execute(sql`
      INSERT INTO planes (fecha, estado, tipo, plan_base_id, generado_en, generado_por, semilla, version_motor, entrada, versiones,
                          resultado, restricciones)
      VALUES ('2026-10-16', 'propuesto', 're_ruteo', ${planBase}, now(), ${usuarioId}, 1, '1.1.0', '{}', '{}', '{}',
              ${JSON.stringify(restricciones)}::jsonb)
      RETURNING id`))[0].id;
    const con = await reruteo({ jornadasNoDisponibles: [], admitidas: {}, congeladas: [], liberadas: [solicitudes[0]] });
    expect((await leerPlan(base.bd, con))!.restricciones?.liberadas).toEqual([solicitudes[0]]);
    await base.bd.execute(sql`UPDATE planes SET estado = 'descartado', descartado_en = now() WHERE id = ${con}`);
    const sin = await reruteo({ jornadasNoDisponibles: [], admitidas: {}, congeladas: [] });
    expect((await leerPlan(base.bd, sin))!.restricciones?.liberadas ?? []).toEqual([]);
  });

  it("ejecuciones_motor guarda consulta_mapa_ms, la deja nula si no hubo consulta y rechaza negativos", async () => {
    const e = { fecha: "2026-10-15", inicioEn: AHORA, finEn: AHORA, duracionMs: 3, resultado: "ok" as const, error: null, planId: null,
      versionMotor: "1.1.0", usuarioId };
    const con = await base.bd.transaction((tx) => insertarEjecucion(tx, { ...e, consultaMapaMs: 12.5 }));
    const sin = await base.bd.transaction((tx) => insertarEjecucion(tx, { ...e, consultaMapaMs: null }));
    const filas = filasDe<{ id: string; consulta_mapa_ms: number | null }>(
      await base.bd.execute(sql`SELECT id, consulta_mapa_ms FROM ejecuciones_motor WHERE id IN (${con}, ${sin})`));
    expect(Object.fromEntries(filas.map((f) => [f.id, f.consulta_mapa_ms]))).toEqual({ [con]: 12.5, [sin]: null });
    expect(await errorDe(base.bd.transaction((tx) => insertarEjecucion(tx, { ...e, consultaMapaMs: -1 })))).toMatch(/ejecuciones_motor_consulta_mapa/);
  });

  it("rs_app sigue sin DELETE en rutas ni UPDATE o DELETE en ejecuciones_motor", async () => {
    expect(await errorDe(base.bd.execute(sql`DELETE FROM rutas`))).toMatch(/permission denied/);
    expect(await errorDe(base.bd.execute(sql`UPDATE ejecuciones_motor SET consulta_mapa_ms = 0`))).toMatch(/permission denied/);
    expect(await errorDe(base.bd.execute(sql`DELETE FROM ejecuciones_motor`))).toMatch(/permission denied/);
  });
});
