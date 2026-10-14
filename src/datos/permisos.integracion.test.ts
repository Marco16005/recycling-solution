import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertarCliente } from "./clientes";
import { leerConfiguracion } from "./configuracion";
import { insertarMovimientoPrivacidad } from "./privacidad";
import { crearBasePostgres, filasDe, type BasePostgres } from "./pruebas/postgres-prueba";
import { clienteDePrueba } from "./pruebas/datos-ejemplo";

const AHORA = new Date("2026-10-13T15:00:00Z");

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

describe("permisos del rol de la aplicación (rs_app)", () => {
  let base: BasePostgres;
  let clienteId: string;

  beforeAll(async () => {
    base = await crearBasePostgres();
    clienteId = (await base.bd.transaction((tx) => insertarCliente(tx, clienteDePrueba(), AHORA))).id;
    const { versionAvisoPrivacidad } = await leerConfiguracion(base.bd);
    await base.bd.transaction((tx) =>
      insertarMovimientoPrivacidad(tx, { clienteId, versionAviso: versionAvisoPrivacidad, accion: "aceptado", medio: "papel", registradoPor: null, en: AHORA }),
    );
    await base.bd.execute(sql`INSERT INTO bitacora (entidad, accion) VALUES ('prueba', 'crear')`);
    await base.bd.execute(sql`INSERT INTO importaciones (id, huella, importados) VALUES (gen_random_uuid(), 'h', 0)`);
  });
  afterAll(async () => base.cerrar());

  it.each(["bitacora", "aceptaciones_privacidad", "importaciones"])("no puede modificar ni borrar %s", async (tabla) => {
    expect(await errorDe(base.bd.execute(sql.raw(`UPDATE ${tabla} SET en = now()`)))).toMatch(/permission denied/);
    expect(await errorDe(base.bd.execute(sql.raw(`DELETE FROM ${tabla}`)))).toMatch(/permission denied/);
  });

  it("no puede cambiar la configuración ni agregar otra fila", async () => {
    expect(await errorDe(base.bd.execute(sql`UPDATE configuracion SET velocidad_kmh = 40`))).toMatch(/permission denied/);
    expect(await errorDe(base.bd.execute(sql`INSERT INTO configuracion (id) VALUES (2)`))).toMatch(/permission denied/);
  });

  it("la fila única de configuración no admite otra, ni siquiera para el dueño", async () => {
    await expect(base.comoAdmin("INSERT INTO configuracion (id) VALUES (2)")).rejects.toThrow(/configuracion_fila_unica/);
  });

  it("no puede crear tablas ni leer el control de migraciones", async () => {
    expect(await errorDe(base.bd.execute(sql`CREATE TABLE intrusa (id int)`))).toMatch(/permission denied/);
    expect(await errorDe(base.bd.execute(sql`SELECT * FROM drizzle.__drizzle_migrations`))).toMatch(/permission denied/);
  });

  it("sí puede leer y escribir clientes", async () => {
    const filas = await base.bd.execute(sql`UPDATE clientes SET notas_acceso = 'Portón 2' WHERE id = ${clienteId} RETURNING id`);
    expect(filasDe(filas)).toHaveLength(1);
  });

  it("los CHECK rechazan datos imposibles", async () => {
    expect(
      await errorDe(base.bd.execute(sql`INSERT INTO ventanas_cliente (cliente_id, dia_semana, hora_inicio, hora_fin) VALUES (${clienteId}, 1, '12:00', '08:00')`)),
    ).toMatch(/ventanas_orden/);
    expect(
      await errorDe(base.bd.execute(sql`INSERT INTO ventanas_cliente (cliente_id, dia_semana, hora_inicio, hora_fin) VALUES (${clienteId}, 7, '08:00', '12:00')`)),
    ).toMatch(/ventanas_dia_semana/);
    expect(await errorDe(base.bd.execute(sql`UPDATE clientes SET lng = NULL WHERE id = ${clienteId}`))).toMatch(/clientes_ubicacion_completa/);
  });

  it("no se puede borrar un cliente con historial de privacidad", async () => {
    expect(await errorDe(base.bd.execute(sql`DELETE FROM clientes WHERE id = ${clienteId}`))).toMatch(/foreign key/);
  });
});
