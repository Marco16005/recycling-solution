import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertarCliente } from "./clientes";
import { insertarOperador, insertarUnidad } from "./flota";
import { insertarJornada } from "./jornadas";
import { crearBasePostgres, filasDe, type BasePostgres } from "./pruebas/postgres-prueba";
import { clienteDePrueba } from "./pruebas/datos-ejemplo";
import { usuarioDePrueba } from "./pruebas/usuarios-prueba";
import { insertarSolicitud, siguienteConsecutivo } from "./solicitudes";

const AHORA = new Date("2026-10-14T15:00:00Z");

async function errorDe(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (error) {
    const causa = (error as { cause?: { message?: string } }).cause;
    return causa?.message ?? String(error);
  }
  return "sin error";
}

describe("modelo del Plan 2 con Postgres real", () => {
  let base: BasePostgres;
  let clienteId: string;
  let usuarioId: string;

  beforeAll(async () => {
    base = await crearBasePostgres();
    clienteId = (await base.bd.transaction((tx) => insertarCliente(tx, clienteDePrueba(), AHORA))).id;
    usuarioId = (await usuarioDePrueba(base.bd, "despachador")).id;
  });
  afterAll(async () => base.cerrar());

  async function solicitud(folio: string) {
    return base.bd.transaction((tx) =>
      insertarSolicitud(tx, {
        folio, clienteId, registradaEn: AHORA, registradaPor: usuarioId, fechaSolicitada: "2026-10-14",
        canal: "telefono", cargaEstimadaKg: null, notas: null, capturaInicioEn: null, capturaFinEn: AHORA,
      }),
    );
  }

  it("rs_app no puede cambiar hora de registro, folio, quién registró ni cliente, ni desactivar el trigger", async () => {
    const id = await solicitud("S-PRUEBA-001");
    for (const cambio of [
      sql`UPDATE solicitudes SET registrada_en = now() WHERE id = ${id}`,
      sql`UPDATE solicitudes SET folio = 'otro' WHERE id = ${id}`,
      sql`UPDATE solicitudes SET registrada_por = NULL WHERE id = ${id}`,
      sql`UPDATE solicitudes SET cliente_id = gen_random_uuid() WHERE id = ${id}`,
    ]) {
      expect(await errorDe(base.bd.execute(cambio))).toMatch(/no se pueden cambiar|foreign key/);
    }
    expect(await errorDe(base.bd.execute(sql`ALTER TABLE solicitudes DISABLE TRIGGER solicitudes_inmutables`))).toMatch(/must be owner/);
    expect(await errorDe(base.bd.execute(sql`UPDATE solicitudes SET notas = 'sí se puede' WHERE id = ${id}`))).toBe("sin error");
  });

  it("rs_app no puede borrar solicitudes ni folios", async () => {
    expect(await errorDe(base.bd.execute(sql`DELETE FROM solicitudes`))).toMatch(/permission denied/);
    expect(await errorDe(base.bd.execute(sql`DELETE FROM folios_dia`))).toMatch(/permission denied/);
  });

  it("veinte consecutivos simultáneos del mismo día no se repiten y uno revertido no se reutiliza como error", async () => {
    const valores = await Promise.all(
      Array.from({ length: 20 }, () => base.bd.transaction((tx) => siguienteConsecutivo(tx, "2026-10-20"))),
    );
    expect([...valores].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    await expect(
      base.bd.transaction(async (tx) => {
        await siguienteConsecutivo(tx, "2026-10-20");
        throw new Error("revertir");
      }),
    ).rejects.toThrow("revertir");
    expect(await base.bd.transaction((tx) => siguienteConsecutivo(tx, "2026-10-20"))).toBe(21);
  });

  it("una unidad y un operador solo pueden tener una jornada por día", async () => {
    const unidad = (n: string) =>
      base.bd.transaction((tx) =>
        insertarUnidad(tx, { placa: `PLA${n}`, numeroEconomico: null, tipo: "doble_rodada", capacidadKg: 8000, rendimientoKmL: 3.5, activo: true, notas: null, documentos: [] }, AHORA),
      );
    const operador = (n: string) =>
      base.bd.transaction((tx) => insertarOperador(tx, { nombre: `Operador ${n}`, telefono: null, activo: true, documentos: [] }, AHORA));
    const [u1, u2, o1, o2] = [await unidad("1"), await unidad("2"), await operador("1"), await operador("2")];
    const jornada = (unidadId: string, operadorId: string) =>
      base.bd.transaction((tx) => insertarJornada(tx, { fecha: "2026-10-21", unidadId, operadorId, disponibleDesde: "08:00", notas: null }, AHORA));
    await jornada(u1.id, o1.id);
    expect(await errorDe(jornada(u1.id, o2.id))).toMatch(/jornadas_unidad_dia/);
    expect(await errorDe(jornada(u2.id, o1.id))).toMatch(/jornadas_operador_dia/);
  });

  it("un usuario operador necesita ficha de operador", async () => {
    expect(
      await errorDe(base.bd.execute(sql`UPDATE usuarios SET rol = 'operador', operador_id = NULL WHERE id = ${usuarioId}`)),
    ).toMatch(/usuarios_operador_con_ficha/);
  });

  it("el catálogo inicial tiene los tipos acordados y ninguno obligatorio por omisión en clientes", async () => {
    const filas = filasDe<{ aplica_a: string; obligatorios: number; total: number }>(
      await base.bd.execute(
        sql`SELECT aplica_a, count(*) FILTER (WHERE obligatorio_por_omision)::int AS obligatorios, count(*)::int AS total FROM tipos_documento GROUP BY aplica_a ORDER BY aplica_a`,
      ),
    );
    expect(filas).toEqual([
      { aplica_a: "cliente", obligatorios: 0, total: 6 },
      { aplica_a: "unidad", obligatorios: 4, total: 5 },
      { aplica_a: "operador", obligatorios: 1, total: 2 },
    ]);
  });
});

describe("publicación del aviso de privacidad", () => {
  let base: BasePostgres;
  beforeAll(async () => {
    base = await crearBasePostgres();
  });
  afterAll(async () => base.cerrar());

  it("publica una versión nueva vigente, con huella y bitácora; no permite repetirla", async () => {
    const { publicarAviso } = await import("./avisos");
    const { huella } = await publicarAviso(base.urlMigrador, { version: "2026-11-01", texto: "Texto del aviso", motivo: "Primera publicación", publicadoPor: "Prueba" });
    expect(huella).toMatch(/^[0-9a-f]{64}$/);
    const config = filasDe<{ version_aviso_privacidad: string; version: number }>(await base.bd.execute(sql`SELECT version_aviso_privacidad, version FROM configuracion`));
    expect(config).toEqual([{ version_aviso_privacidad: "2026-11-01", version: 2 }]);
    await expect(publicarAviso(base.urlMigrador, { version: "2026-11-01", texto: "Otro", motivo: "x", publicadoPor: "Prueba" })).rejects.toThrow(/ya existe/);
    const avisos = filasDe<{ version: string; texto: string | null }>(await base.bd.execute(sql`SELECT version, texto FROM avisos_privacidad ORDER BY publicado_en`));
    expect(avisos).toEqual([{ version: "2026-10", texto: null }, { version: "2026-11-01", texto: "Texto del aviso" }]);
  });
});
