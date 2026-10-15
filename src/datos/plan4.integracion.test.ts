import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertarCliente } from "./clientes";
import { insertarOperador, insertarUnidad } from "./flota";
import { insertarJornada } from "./jornadas";
import { clienteDePrueba } from "./pruebas/datos-ejemplo";
import { operadorDePrueba, unidadDePrueba } from "./pruebas/flota-ejemplo";
import { crearBasePostgres, filasDe, type BasePostgres } from "./pruebas/postgres-prueba";
import { usuarioDePrueba } from "./pruebas/usuarios-prueba";
import { insertarSolicitud } from "./solicitudes";

const AHORA = new Date("2026-10-15T14:00:00Z");

/** Mensaje de Postgres de la causa del error que lanza Drizzle. */
async function errorDe(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (error) {
    const causa = (error as { cause?: { message?: string } }).cause;
    return causa?.message ?? String(error);
  }
  return "sin error";
}

describe("modelo del Plan 4 con Postgres real", () => {
  let base: BasePostgres;
  let usuarioId: string;
  let jornadaId: string;
  let solicitudId: string;

  beforeAll(async () => {
    base = await crearBasePostgres();
    usuarioId = (await usuarioDePrueba(base.bd, "despachador")).id;
    const clienteId = (await base.bd.transaction((tx) => insertarCliente(tx, clienteDePrueba(), AHORA))).id;
    solicitudId = await base.bd.transaction((tx) =>
      insertarSolicitud(tx, {
        folio: "S-20261015-001", clienteId, registradaEn: AHORA, registradaPor: usuarioId, fechaSolicitada: "2026-10-15",
        canal: "telefono", cargaEstimadaKg: null, notas: null, capturaInicioEn: null, capturaFinEn: AHORA,
      }),
    );
    const unidad = await base.bd.transaction((tx) => insertarUnidad(tx, unidadDePrueba(), AHORA));
    const operador = await base.bd.transaction((tx) => insertarOperador(tx, operadorDePrueba(), AHORA));
    jornadaId = await base.bd.transaction((tx) =>
      insertarJornada(tx, { fecha: "2026-10-15", unidadId: unidad.id, operadorId: operador.id, disponibleDesde: "08:00", notas: null }, AHORA),
    );
  });
  afterAll(async () => base.cerrar());

  async function plan(fecha: string, estado: "propuesto" | "validado" | "descartado" = "propuesto"): Promise<string> {
    const validado = estado === "validado";
    const filas = await base.bd.execute(sql`
      INSERT INTO planes (fecha, estado, generado_en, generado_por, semilla, version_motor, entrada, versiones, resultado,
                          revision_iniciada_en, validado_en, validado_por, requisitos_confirmados_en, descartado_en)
      VALUES (${fecha}, ${estado}, now(), ${usuarioId}, 20261015, '1.0.0', '{}', '{}', '{}',
              ${validado ? AHORA : null}, ${validado ? AHORA : null}, ${validado ? usuarioId : null}, ${validado ? AHORA : null},
              ${estado === "descartado" ? AHORA : null})
      RETURNING id`);
    return filasDe<{ id: string }>(filas)[0].id;
  }

  async function ruta(planId: string, numeroViaje = 1): Promise<string> {
    const filas = await base.bd.execute(sql`
      INSERT INTO rutas (plan_id, jornada_id, numero_viaje, salida_estimada, regreso_estimado, fin_descarga_estimado, carga_kg,
                         km_estimados, km_contrafactual, rendimiento_km_l_usado, disponible_para_salir_en, asignada_en)
      VALUES (${planId}, ${jornadaId}, ${numeroViaje}, ${AHORA}, ${AHORA}, ${AHORA}, 1000, 12.5, 20, 3.5, ${AHORA}, ${AHORA})
      RETURNING id`);
    return filasDe<{ id: string }>(filas)[0].id;
  }

  const parada = (rutaId: string, secuencia: number, vigente: boolean) =>
    base.bd.execute(sql`
      INSERT INTO paradas (ruta_id, solicitud_id, secuencia, ventana_inicio, ventana_fin, llegada_estimada, inicio_estimado,
                           fin_estimado, espera_min, carga_kg, km_desde_anterior, km_contrafactual, vigente)
      VALUES (${rutaId}, ${solicitudId}, ${secuencia}, '08:00', '12:00', ${AHORA}, ${AHORA}, ${AHORA}, 0, 1000, 6, 12, ${vigente})`);

  it("una solicitud solo puede tener una parada vigente; las retiradas no cuentan", async () => {
    const a = await ruta(await plan("2026-10-15", "validado"));
    const b = await ruta(await plan("2026-10-16", "validado"));
    expect(await errorDe(parada(a, 1, true))).toBe("sin error");
    expect(await errorDe(parada(b, 1, true))).toMatch(/paradas_solicitud_vigente/);
    expect(await errorDe(parada(b, 1, false))).toBe("sin error");
  });

  it("una fecha tiene a lo sumo un plan validado y un propuesto; los descartados no cuentan", async () => {
    expect(await errorDe(plan("2026-10-15", "validado"))).toMatch(/planes_un_validado_por_fecha/);
    await plan("2026-10-20");
    expect(await errorDe(plan("2026-10-20"))).toMatch(/planes_un_propuesto_por_fecha/);
    expect(await errorDe(plan("2026-10-20", "descartado"))).toBe("sin error");
    expect(await errorDe(plan("2026-10-20", "descartado"))).toBe("sin error");
  });

  it("un plan validado exige quién validó, revisión iniciada y requisitos confirmados", async () => {
    expect(
      await errorDe(base.bd.execute(sql`
        INSERT INTO planes (fecha, estado, generado_en, generado_por, semilla, version_motor, entrada, versiones, resultado, validado_en)
        VALUES ('2026-10-21', 'validado', now(), ${usuarioId}, 1, '1.0.0', '{}', '{}', '{}', now())`)),
    ).toMatch(/planes_validado_completo/);
  });

  it("una ejecución fallida o agotada no apunta a un plan", async () => {
    const planId = await plan("2026-10-22");
    const ejecucion = (resultado: string, conPlan: boolean) =>
      base.bd.execute(sql`
        INSERT INTO ejecuciones_motor (fecha, inicio_en, fin_en, duracion_ms, resultado, plan_id, version_motor, usuario_id)
        VALUES ('2026-10-22', ${AHORA}, ${AHORA}, 3.2, ${resultado}::resultado_motor, ${conPlan ? planId : null}, '1.0.0', ${usuarioId})`);
    expect(await errorDe(ejecucion("ok", true))).toBe("sin error");
    expect(await errorDe(ejecucion("ok", false))).toBe("sin error");
    expect(await errorDe(ejecucion("error", true))).toMatch(/ejecuciones_motor_plan/);
    expect(await errorDe(ejecucion("tiempo_agotado", false))).toBe("sin error");
  });

  it("rs_app no puede cambiar ni borrar ejecuciones del motor, ni borrar planes, rutas o paradas", async () => {
    expect(await errorDe(base.bd.execute(sql`UPDATE ejecuciones_motor SET duracion_ms = 0`))).toMatch(/permission denied/);
    expect(await errorDe(base.bd.execute(sql`DELETE FROM ejecuciones_motor`))).toMatch(/permission denied/);
    for (const tabla of ["paradas", "rutas", "planes"]) {
      expect(await errorDe(base.bd.execute(sql.raw(`DELETE FROM ${tabla}`)))).toMatch(/permission denied/);
    }
    expect(await errorDe(base.bd.execute(sql`UPDATE paradas SET vigente = false`))).toBe("sin error");
  });

  it("una jornada con rutas no se puede borrar", async () => {
    expect(await errorDe(base.bd.execute(sql`DELETE FROM jornadas WHERE id = ${jornadaId}`))).toMatch(/foreign key/);
  });

  it("las solicitudes aceptan los estados programada y en_ruta", async () => {
    for (const estado of ["programada", "en_ruta", "pendiente"]) {
      expect(await errorDe(base.bd.execute(sql`UPDATE solicitudes SET estado = ${estado}::estado_solicitud WHERE id = ${solicitudId}`))).toBe("sin error");
    }
  });
});
