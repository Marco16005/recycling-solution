import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leerConfiguracionCompleta } from "./configuracion";
import { crearBasePostgres, type BasePostgres } from "./pruebas/postgres-prueba";

async function errorDe(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (error) {
    const causa = (error as { cause?: { message?: string } }).cause;
    return causa?.message ?? String(error);
  }
  return "sin error";
}

describe("modelo del Plan 8 con Postgres real (migración 0010)", () => {
  let base: BasePostgres;
  beforeAll(async () => { base = await crearBasePostgres(); });
  afterAll(async () => base.cerrar());

  it("la configuración trae tolerancia 15 y el CHECK rechaza -1 y 61", async () => {
    expect((await leerConfiguracionCompleta(base.bd)).toleranciaReadmisionMin).toBe(15);
    for (const valor of [-1, 61]) {
      expect(await errorDe(base.bd.execute(sql`UPDATE configuracion SET tolerancia_readmision_min = ${valor}`))).toMatch(/configuracion_tolerancia_readmision/);
    }
    for (const valor of [0, 60]) {
      expect(await errorDe(base.bd.execute(sql`UPDATE configuracion SET tolerancia_readmision_min = ${valor}`))).toBe("sin error");
    }
  });
});
