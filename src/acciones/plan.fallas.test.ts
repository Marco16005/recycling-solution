import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BD } from "@/datos/bd";
import { bitacora, ejecucionesMotor, paradas, planes, rutas, solicitudes } from "@/datos/esquema";
import { crearBdPrueba } from "@/datos/pruebas/bd-prueba";
import { AHORA_PLAN, clienteHabilitado, FECHA_PLAN, jornadaDisponible, ponerPatio, solicitudPendiente } from "@/datos/pruebas/escenario-plan";
import { hacerFallarBitacora, usuarioDePrueba } from "@/datos/pruebas/usuarios-prueba";
import type { UsuarioSesion } from "@/seguridad/permisos";
import { generarPlanDelDia, iniciarRevision, LIMITE_MOTOR_MS, validarPlanDelDia } from "./plan.nucleo";
import type { Contexto } from "./tipos";

// El motor real, salvo cuando una prueba lo hace fallar.
const falla = vi.hoisted(() => ({ activa: false }));
vi.mock("@/motor", async (original) => {
  const real = await original<typeof import("@/motor")>();
  return {
    ...real,
    generarPlan: (...args: Parameters<typeof real.generarPlan>) => {
      if (falla.activa) throw new TypeError("falla sintética del motor con datos de Cartonera Norte");
      return real.generarPlan(...args);
    },
  };
});

describe("plan del día ante fallas (K7 y reversión)", () => {
  let bd: BD;
  let despachador: UsuarioSesion;
  const ctx = (): Contexto => ({ bd, usuario: despachador, ahora: AHORA_PLAN });

  beforeEach(async () => {
    falla.activa = false;
    bd = await crearBdPrueba();
    despachador = await usuarioDePrueba(bd, "despachador");
    await ponerPatio(bd);
    await jornadaDisponible(bd, FECHA_PLAN, "FALLA1");
    const c = await clienteHabilitado(bd, "Cartonera Norte", 0.01);
    await solicitudPendiente(bd, c.id, despachador.id, FECHA_PLAN);
  });
  afterEach(() => vi.restoreAllMocks());

  it("si el motor lanza un error, la ejecución queda registrada sin plan y sin datos personales", async () => {
    falla.activa = true;
    expect(await generarPlanDelDia(ctx(), FECHA_PLAN)).toMatchObject({ ok: false, error: "invalido" });
    expect(await bd.select().from(planes)).toEqual([]);
    const [e] = await bd.select().from(ejecucionesMotor);
    expect(e).toMatchObject({ resultado: "error", planId: null, error: "TypeError" });
    expect((await bd.select().from(bitacora)).map((b) => [b.entidad, b.accion])).toEqual([["ejecucion_motor", "ejecutar"]]);
  });

  it("si el motor tarda más del límite, cuenta como tiempo agotado y su plan no se guarda", async () => {
    // Dos lecturas seguidas del reloj siempre distan más que el límite.
    let llamada = 0;
    vi.spyOn(performance, "now").mockImplementation(() => llamada++ * (LIMITE_MOTOR_MS + 1));
    expect(await generarPlanDelDia(ctx(), FECHA_PLAN)).toMatchObject({ ok: false, error: "invalido" });
    expect(await bd.select().from(planes)).toEqual([]);
    expect(await bd.select().from(ejecucionesMotor)).toEqual([expect.objectContaining({ resultado: "tiempo_agotado", planId: null })]);
  });

  it("si falla el guardado del plan, la ejecución queda registrada (ok, sin plan) y no queda plan a medias", async () => {
    await bd.execute(sql.raw("CREATE FUNCTION falla_planes() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'planes no disponible'; END $$"));
    await bd.execute(sql.raw("CREATE TRIGGER falla_planes BEFORE INSERT ON planes FOR EACH ROW EXECUTE FUNCTION falla_planes()"));
    expect(await generarPlanDelDia(ctx(), FECHA_PLAN)).toMatchObject({ ok: false, error: "invalido" });
    expect(await bd.select().from(planes)).toEqual([]);
    const [e] = await bd.select().from(ejecucionesMotor);
    expect(e).toMatchObject({ resultado: "ok", planId: null });
    expect(e.error).toMatch(/^guardado:/);
  });

  it("si la bitácora falla después de escribir rutas y paradas, la validación se revierte completa", async () => {
    const generado = await generarPlanDelDia(ctx(), FECHA_PLAN);
    if (!generado.ok) throw new Error(JSON.stringify(generado));
    const { planId } = generado.valor;
    await iniciarRevision(ctx(), planId);
    const [p] = await bd.select().from(planes).where(eq(planes.id, planId));
    await hacerFallarBitacora(bd);
    await expect(validarPlanDelDia(ctx(), planId, p.version, { requisitosConfirmados: true })).rejects.toThrow();
    expect(await bd.select().from(rutas)).toEqual([]);
    expect(await bd.select().from(paradas)).toEqual([]);
    expect((await bd.select().from(solicitudes)).map((x) => x.estado)).toEqual(["pendiente"]);
    expect((await bd.select().from(planes).where(eq(planes.id, planId)))[0].estado).toBe("propuesto");
  });
});
