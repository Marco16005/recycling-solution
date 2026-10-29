import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ajustarPlanDelDia, generarPlanDelDia } from "@/acciones/plan.nucleo";
import type { Contexto, Resultado } from "@/acciones/tipos";
import { planes } from "@/datos/esquema";
import { AHORA_PLAN, clienteHabilitado, FECHA_PLAN, jornadaDisponible, ponerPatio, solicitudPendiente } from "@/datos/pruebas/escenario-plan";
import { crearBasePostgres, type BasePostgres } from "@/datos/pruebas/postgres-prueba";
import { usuarioDePrueba } from "@/datos/pruebas/usuarios-prueba";
import type { Plan } from "@/motor";
import type { UsuarioSesion } from "@/seguridad/permisos";
import { obtenerPlan } from "./plan.nucleo";

// Plan 8, P8-4: la vista del plan con el antes y después del reacomodo. AHORA_PLAN es 07:00 en Ciudad de México.

function valor<T>(r: Resultado<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.valor;
}
const metricas = (m: NonNullable<Plan["reacomodo"]>["antes"]) =>
  ({ ruteadas: m.ruteadas, pospuestas: m.pospuestas, tiempoMuertoMin: m.tiempoMuertoMin, km: m.km, minutosTraslado: m.minutosTraslado });

describe("obtenerPlan con reacomodo (Plan 8)", () => {
  let base: BasePostgres;
  let despachador: UsuarioSesion;
  const ctx = (usuario: UsuarioSesion = despachador): Contexto => ({ bd: base.bd, usuario, ahora: AHORA_PLAN, reloj: () => AHORA_PLAN });
  const resultado = async (planId: string) => (await base.bd.select().from(planes).where(eq(planes.id, planId)))[0].resultado as Plan;

  beforeEach(async () => {
    base = await crearBasePostgres();
    despachador = await usuarioDePrueba(base.bd, "despachador");
    await ponerPatio(base.bd);
    await jornadaDisponible(base.bd, FECHA_PLAN, "REAC01", { capacidadKg: 1700 });
    for (const [i, nombre] of ["Norte", "Centro", "Sur"].entries()) {
      const c = await clienteHabilitado(base.bd, `Cartonera ${nombre}`, 0.01 * (i + 1));
      await solicitudPendiente(base.bd, c.id, despachador.id, FECHA_PLAN, new Date(AHORA_PLAN.getTime() - (4 - i) * 60_000));
    }
  });
  afterEach(async () => base.cerrar());

  it("obtenerPlan expone antes y después del reacomodo, y null en un plan 1.1.0", async () => {
    const { planId } = valor(await generarPlanDelDia(ctx(), FECHA_PLAN));
    const r = (await resultado(planId)).reacomodo!;
    const vista = valor(await obtenerPlan(ctx(), FECHA_PLAN));
    expect(vista.reacomodo).toEqual({
      antes: metricas(r.antes), despues: metricas(r.despues),
      readmitidas: r.readmision.filter((d) => d.resultado === "admitida").length,
      alargaLaJornada: r.readmision.filter((d) => d.resultado === "pospuesta" && d.motivo === "alarga_la_jornada").length,
      movimientos: r.movimientos.fase2 + r.movimientos.fase4, ajustesManualesDespues: 0,
    });
    expect(vista.reacomodo!.despues.ruteadas).toBe(vista.resumen!.ruteadas);
    // Un plan guardado con la versión anterior no tiene reacomodo.
    await base.bd.execute(sql`
      UPDATE planes SET version_motor = '1.1.0',
        resultado = jsonb_set(jsonb_set(resultado - 'reacomodo', '{versionMotor}', '"1.1.0"'), '{resumen}', (resultado->'resumen') - 'tiempoMuertoMin')
      WHERE id = ${planId}`);
    expect(valor(await obtenerPlan(ctx(), FECHA_PLAN)).reacomodo).toBeNull();
  });

  it("tras un ajuste manual, ajustesManualesDespues = 1 y despues sigue siendo el del motor", async () => {
    const { planId } = valor(await generarPlanDelDia(ctx(), FECHA_PLAN));
    const antes = valor(await obtenerPlan(ctx(), FECHA_PLAN));
    const primera = antes.unidades[0].viajes[0].paradas[0].solicitudId;
    valor(await ajustarPlanDelDia(ctx(), planId, antes.version, { tipo: "posponer", solicitudId: primera }));
    const despues = valor(await obtenerPlan(ctx(), FECHA_PLAN));
    expect(despues.reacomodo!.ajustesManualesDespues).toBe(1);
    expect(despues.reacomodo!.despues).toEqual(antes.reacomodo!.despues);
    expect(despues.reacomodo!.antes).toEqual(antes.reacomodo!.antes);
    // El resumen sí refleja el ajuste.
    expect(despues.resumen!.ruteadas).toBe(antes.resumen!.ruteadas - 1);
    expect(despues.resumen!.tiempoMuertoMin).not.toBeUndefined();
  });
});
