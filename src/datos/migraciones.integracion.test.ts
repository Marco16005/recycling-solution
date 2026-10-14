import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { migrar } from "./migrar";
import { crearBasePostgres, filasDe, type BasePostgres } from "./pruebas/postgres-prueba";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: unknown[] };

describe("migraciones en Postgres real", () => {
  let base: BasePostgres | null = null;
  afterEach(async () => {
    await base?.cerrar();
    base = null;
  });

  it("una base vacía queda con todas las migraciones, la versión del aviso y la configuración", async () => {
    base = await crearBasePostgres();
    const migraciones = await base.bd.execute(sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`).catch(() => null);
    // rs_app no ve el esquema drizzle; lo comprueba el migrador al volver a correr.
    expect(migraciones).toBeNull();
    expect(await migrar(base.urlMigrador)).toEqual({ aplicadas: journal.entries.length });
    const config = await base.bd.execute(sql`SELECT version_aviso_privacidad FROM configuracion`);
    expect(filasDe(config)).toEqual([{ version_aviso_privacidad: "2026-10" }]);
  });

  it("dos migradores a la vez sobre una base vacía terminan bien", async () => {
    base = await crearBasePostgres({ migrar: false });
    const resultados = await Promise.all([migrar(base.urlMigrador), migrar(base.urlMigrador)]);
    expect(resultados).toEqual([{ aplicadas: journal.entries.length }, { aplicadas: journal.entries.length }]);
  });

  it("detecta una migración aplicada que ya no coincide con su archivo", async () => {
    base = await crearBasePostgres();
    await base.comoAdmin("UPDATE drizzle.__drizzle_migrations SET hash = 'alterada' WHERE id = (SELECT min(id) FROM drizzle.__drizzle_migrations)");
    await expect(migrar(base.urlMigrador)).rejects.toThrow(/no coincide con su archivo/);
  });
});
