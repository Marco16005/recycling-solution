import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AHORA_PLAN, FECHA_PLAN, jornadaDisponible } from "./pruebas/escenario-plan";
import { crearBasePostgres, type BasePostgres } from "./pruebas/postgres-prueba";
import { usuarioDePrueba } from "./pruebas/usuarios-prueba";

async function errorDe(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (error) {
    const causa = (error as { cause?: { message?: string } }).cause;
    return causa?.message ?? String(error);
  }
  return "sin error";
}

describe("modelo del Plan 5 con Postgres real", () => {
  let base: BasePostgres;
  let usuarioId: string;
  let jornadaId: string;

  beforeAll(async () => {
    base = await crearBasePostgres();
    usuarioId = (await usuarioDePrueba(base.bd, "operador")).id;
    jornadaId = (await jornadaDisponible(base.bd, FECHA_PLAN, "OPER01")).jornadaId;
  });
  afterAll(async () => base.cerrar());

  const evento = (eventoId: string, resultado = "aplicado", motivoRechazo: string | null = null) =>
    base.bd.execute(sql`
      INSERT INTO eventos_operador (evento_id, jornada_id, tipo, ocurrido_en, recibido_en, huella, usuario_id, resultado, motivo_rechazo)
      VALUES (${eventoId}, ${jornadaId}, 'check_in', ${AHORA_PLAN}, ${AHORA_PLAN}, 'h', ${usuarioId}, ${resultado}::resultado_evento, ${motivoRechazo})`);

  it("un evento_id solo se guarda una vez; un rechazado exige su motivo", async () => {
    const id = randomUUID();
    expect(await errorDe(evento(id))).toBe("sin error");
    expect(await errorDe(evento(id))).toMatch(/eventos_operador_evento_id_unique/);
    expect(await errorDe(evento(randomUUID(), "rechazado"))).toMatch(/eventos_operador_rechazo/);
    expect(await errorDe(evento(randomUUID(), "rechazado", "La ruta cambió"))).toBe("sin error");
  });

  it("rs_app solo llena la conciliación de un evento; no cambia ni borra eventos ni borra incidentes", async () => {
    expect(await errorDe(base.bd.execute(sql`UPDATE eventos_operador SET resultado = 'aplicado'`))).toMatch(/permission denied/);
    expect(await errorDe(base.bd.execute(sql`UPDATE eventos_operador SET ocurrido_en = now()`))).toMatch(/permission denied/);
    expect(await errorDe(base.bd.execute(sql`DELETE FROM eventos_operador`))).toMatch(/permission denied/);
    expect(
      await errorDe(base.bd.execute(sql`UPDATE eventos_operador SET conciliado_en = now(), conciliado_por = ${usuarioId}, nota_conciliacion = 'Llamó al despachador'`)),
    ).toBe("sin error");
    expect(await errorDe(base.bd.execute(sql`DELETE FROM incidentes`))).toMatch(/permission denied/);
  });

  it("un incidente resuelto trae quién, cuándo y la acción; la descripción es breve", async () => {
    const incidente = (descripcion: string, resuelto: boolean) =>
      base.bd.execute(sql`
        INSERT INTO incidentes (evento_id, huella, jornada_id, tipo, descripcion, reportado_en, reportado_por, resuelto_en, resuelto_por, accion)
        VALUES (${randomUUID()}, 'h', ${jornadaId}, 'averia', ${descripcion}, ${AHORA_PLAN}, ${usuarioId},
                ${resuelto ? AHORA_PLAN : null}, ${resuelto ? usuarioId : null}, ${resuelto ? "continuar" : null}::accion_incidente)`);
    expect(await errorDe(incidente("Se ponchó una llanta", false))).toBe("sin error");
    expect(await errorDe(incidente("x".repeat(301), false))).toMatch(/incidentes_descripcion/);
    expect(await errorDe(incidente("Resuelto", true))).toBe("sin error");
    expect(
      await errorDe(base.bd.execute(sql`
        INSERT INTO incidentes (evento_id, huella, jornada_id, tipo, descripcion, reportado_en, reportado_por, accion)
        VALUES (${randomUUID()}, 'h', ${jornadaId}, 'otro', 'Sin resolver', ${AHORA_PLAN}, ${usuarioId}, 'cancelar')`)),
    ).toMatch(/incidentes_resuelto/);
  });

  it("un re-ruteo exige su plan base y sus restricciones; las jornadas empiezan sin operación", async () => {
    expect(
      await errorDe(base.bd.execute(sql`
        INSERT INTO planes (fecha, tipo, generado_en, generado_por, semilla, version_motor, entrada, versiones, resultado)
        VALUES ('2026-10-21', 're_ruteo', now(), ${usuarioId}, 1, '1.0.0', '{}', '{}', '{}')`)),
    ).toMatch(/planes_re_ruteo/);
    const [j] = (await base.bd.execute(sql`SELECT version_operacion FROM jornadas WHERE id = ${jornadaId}`) as unknown as { rows: { version_operacion: number }[] }).rows;
    expect(j.version_operacion).toBe(0);
  });
});
