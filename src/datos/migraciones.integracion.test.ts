import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { insertarCliente } from "./clientes";
import type { UnidadEntrada } from "@/dominio/flota/tipos";
import { insertarUnidad } from "./flota";
import { migrar } from "./migrar";
import { clienteDePrueba } from "./pruebas/datos-ejemplo";
import { crearBasePostgres, filasDe, type BasePostgres } from "./pruebas/postgres-prueba";

const AHORA = new Date("2026-11-07T15:00:00Z");
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

  it("con el historial alterado no aplica una migración pendiente", async () => {
    base = await crearBasePostgres();
    // Copia del repositorio con una migración nueva al final.
    const raiz = mkdtempSync(path.join(tmpdir(), "migraciones-"));
    cpSync("drizzle", path.join(raiz, "drizzle"), { recursive: true });
    cpSync("infra", path.join(raiz, "infra"), { recursive: true });
    const rutaJournal = path.join(raiz, "drizzle/meta/_journal.json");
    const copia = JSON.parse(readFileSync(rutaJournal, "utf8"));
    const ultima = copia.entries.at(-1);
    copia.entries.push({ ...ultima, idx: ultima.idx + 1, when: ultima.when + 1000, tag: "9999_pendiente" });
    writeFileSync(rutaJournal, JSON.stringify(copia));
    writeFileSync(path.join(raiz, "drizzle/9999_pendiente.sql"), "CREATE TABLE prueba_pendiente (id int);");

    await base.comoAdmin("UPDATE drizzle.__drizzle_migrations SET hash = 'alterada' WHERE id = (SELECT min(id) FROM drizzle.__drizzle_migrations)");
    await expect(migrar(base.urlMigrador, raiz)).rejects.toThrow(/no coincide con su archivo/);
    const tabla = await base.bd.execute(sql`SELECT to_regclass('public.prueba_pendiente') IS NOT NULL AS existe`);
    expect(filasDe(tabla)).toEqual([{ existe: false }]);
  });

  it("una base del Plan 1 con usuarios operadores migra a la versión actual sin perder identidades ni duplicar fichas", async () => {
    base = await crearBasePostgres({ migrar: false });
    // Copia del repositorio que llega solo hasta la última migración del Plan 1 (0002), sin los permisos posteriores.
    const raiz = mkdtempSync(path.join(tmpdir(), "plan1-"));
    cpSync("drizzle", path.join(raiz, "drizzle"), { recursive: true });
    const rutaJournal = path.join(raiz, "drizzle/meta/_journal.json");
    const copia = JSON.parse(readFileSync(rutaJournal, "utf8")) as { entries: { tag: string }[] };
    copia.entries = copia.entries.slice(0, copia.entries.findIndex((e) => e.tag === "0002_generacion_credenciales") + 1);
    writeFileSync(rutaJournal, JSON.stringify(copia));
    mkdirSync(path.join(raiz, "infra/db"), { recursive: true });
    writeFileSync(path.join(raiz, "infra/db/permisos.sql"), "SELECT 1;");
    expect(await migrar(base.urlMigrador, raiz)).toEqual({ aplicadas: 3 });

    const personas = [
      { id: "a1", nombre: "Ana Operadora", rol: "operador", activo: true },
      { id: "b2", nombre: "Beto Inactivo", rol: "operador", activo: false },
      { id: "c3", nombre: "Caro Despacho", rol: "despachador", activo: true },
    ];
    for (const p of personas) {
      await base.comoAdmin(`
        INSERT INTO "user" (id, name, email, email_verified) VALUES ('auth-${p.id}', '${p.nombre}', '${p.id}@plan1.local', true);
        INSERT INTO account (id, account_id, provider_id, user_id, password, updated_at)
          VALUES ('cuenta-${p.id}', 'auth-${p.id}', 'credential', 'auth-${p.id}', 'hash-sintetico', now());
        INSERT INTO usuarios (auth_user_id, nombre, rol, activo) VALUES ('auth-${p.id}', '${p.nombre}', '${p.rol}', ${p.activo});`);
    }
    await base.comoAdmin(`INSERT INTO session (id, expires_at, token, updated_at, user_id)
      VALUES ('sesion-a1', now() + interval '1 day', 'token-sintetico-a1', now(), 'auth-a1')`);

    expect(await migrar(base.urlMigrador)).toEqual({ aplicadas: journal.entries.length });
    expect(await migrar(base.urlMigrador)).toEqual({ aplicadas: journal.entries.length });

    const ligados = filasDe<{ auth_user_id: string; rol: string; operador: string | null }>(
      await base.bd.execute(sql`
        SELECT u.auth_user_id, u.rol, o.nombre AS operador
        FROM usuarios u LEFT JOIN operadores o ON o.id = u.operador_id ORDER BY u.auth_user_id`),
    );
    expect(ligados).toEqual([
      { auth_user_id: "auth-a1", rol: "operador", operador: "Ana Operadora" },
      { auth_user_id: "auth-b2", rol: "operador", operador: "Beto Inactivo" },
      { auth_user_id: "auth-c3", rol: "despachador", operador: null },
    ]);
    const conteos = filasDe(
      await base.bd.execute(sql`
        SELECT (SELECT count(*)::int FROM operadores) AS operadores, (SELECT count(*)::int FROM "user") AS identidades,
               (SELECT count(*)::int FROM account) AS cuentas, (SELECT count(*)::int FROM session) AS sesiones`),
    );
    expect(conteos).toEqual([{ operadores: 2, identidades: 3, cuentas: 3, sesiones: 1 }]);
  });

  it("la migración de torton y tráiler conserva unidades y clientes y deja guardar los tipos nuevos (2026-11-07)", async () => {
    base = await crearBasePostgres({ migrar: false });
    // Copia del repositorio hasta la última migración anterior (0010), con sus permisos.
    const raiz = mkdtempSync(path.join(tmpdir(), "tipos-"));
    cpSync("drizzle", path.join(raiz, "drizzle"), { recursive: true });
    cpSync("infra/db", path.join(raiz, "infra/db"), { recursive: true });
    const rutaJournal = path.join(raiz, "drizzle/meta/_journal.json");
    const copia = JSON.parse(readFileSync(rutaJournal, "utf8")) as { entries: { tag: string }[] };
    copia.entries = copia.entries.slice(0, copia.entries.findIndex((e) => e.tag === "0010_reacomodo") + 1);
    writeFileSync(rutaJournal, JSON.stringify(copia));
    expect(await migrar(base.urlMigrador, raiz)).toEqual({ aplicadas: copia.entries.length });
    const bd = base.bd;
    const unidad = (placa: string, tipo: UnidadEntrada["tipo"], capacidadKg: number) =>
      bd.transaction((tx) => insertarUnidad(tx, { placa, numeroEconomico: null, tipo, capacidadKg, rendimientoKmL: 3, activo: true, notas: null, documentos: [] }, AHORA));
    await unidad("ANTES1", "doble_rodada", 8000);
    const { id: clienteId } = await bd.transaction((tx) => insertarCliente(tx, clienteDePrueba({ nombre: "Cartonera Antes", tiposUnidadAdmitidos: ["doble_rodada", "rabon"] }), AHORA));

    expect(await migrar(base.urlMigrador)).toEqual({ aplicadas: journal.entries.length });
    await unidad("TORTON1", "torton", 15000);
    await unidad("TRAILER1", "trailer", 30000);
    await base.bd.execute(sql`UPDATE clientes SET tipos_unidad_admitidos = '{doble_rodada,rabon,trailer}' WHERE id = ${clienteId}`);

    expect(filasDe(await base.bd.execute(sql`SELECT placa, tipo::text AS tipo FROM unidades ORDER BY placa`))).toEqual([
      { placa: "ANTES1", tipo: "doble_rodada" }, { placa: "TORTON1", tipo: "torton" }, { placa: "TRAILER1", tipo: "trailer" },
    ]);
    expect(filasDe(await base.bd.execute(sql`SELECT nombre, tipos_unidad_admitidos::text[] AS tipos FROM clientes`))).toEqual([
      { nombre: "Cartonera Antes", tipos: ["doble_rodada", "rabon", "trailer"] },
    ]);
  });

  it("la migración del cambio de contraseña obliga a cambiarla solo a quien tiene una temporal de la aplicación (2026-11-07)", async () => {
    base = await crearBasePostgres({ migrar: false });
    // Copia del repositorio hasta la migración anterior (0011), con sus permisos.
    const raiz = mkdtempSync(path.join(tmpdir(), "claves-"));
    cpSync("drizzle", path.join(raiz, "drizzle"), { recursive: true });
    cpSync("infra/db", path.join(raiz, "infra/db"), { recursive: true });
    const rutaJournal = path.join(raiz, "drizzle/meta/_journal.json");
    const copia = JSON.parse(readFileSync(rutaJournal, "utf8")) as { entries: { tag: string }[] };
    copia.entries = copia.entries.slice(0, copia.entries.findIndex((e) => e.tag === "0011_tipos_torton_trailer") + 1);
    writeFileSync(rutaJournal, JSON.stringify(copia));
    expect(await migrar(base.urlMigrador, raiz)).toEqual({ aplicadas: copia.entries.length });

    // Último evento de contraseña de cada quien, en orden: el que cuenta es el más reciente.
    const historia: Record<string, string[]> = {
      alta_app: ["crear"],
      alta_script: ["crear_por_script"],
      app_luego_script: ["crear", "restablecer_clave_por_script"],
      script_luego_app: ["crear_por_script", "restablecer_clave"],
      script_luego_rol: ["crear_por_script", "cambiar_rol"],
      sin_eventos: [],
    };
    for (const [clave, acciones] of Object.entries(historia)) {
      await base.comoAdmin(`
        INSERT INTO "user" (id, name, email, email_verified) VALUES ('auth-${clave}', '${clave}', '${clave}@claves.local', true);
        INSERT INTO usuarios (auth_user_id, nombre, rol) VALUES ('auth-${clave}', '${clave}', 'despachador');`);
      for (const [i, accion] of acciones.entries()) {
        await base.comoAdmin(`
          INSERT INTO bitacora (en, entidad, entidad_id, accion, campos)
          SELECT timestamp with time zone '2026-11-01 10:00:00Z' + interval '${i} hour', 'usuario', id, '${accion}', '{clave}'
          FROM usuarios WHERE auth_user_id = 'auth-${clave}'`);
      }
    }

    expect(await migrar(base.urlMigrador)).toEqual({ aplicadas: journal.entries.length });
    expect(filasDe(await base.bd.execute(sql`SELECT nombre, debe_cambiar_clave FROM usuarios ORDER BY nombre`))).toEqual([
      { nombre: "alta_app", debe_cambiar_clave: true },
      { nombre: "alta_script", debe_cambiar_clave: false },
      { nombre: "app_luego_script", debe_cambiar_clave: false },
      { nombre: "script_luego_app", debe_cambiar_clave: true },
      { nombre: "script_luego_rol", debe_cambiar_clave: false },
      { nombre: "sin_eventos", debe_cambiar_clave: false },
    ]);
  });

  it("detecta una migración aplicada que ya no coincide con su archivo", async () => {
    base = await crearBasePostgres();
    await base.comoAdmin("UPDATE drizzle.__drizzle_migrations SET hash = 'alterada' WHERE id = (SELECT min(id) FROM drizzle.__drizzle_migrations)");
    await expect(migrar(base.urlMigrador)).rejects.toThrow(/no coincide con su archivo/);
  });
});
