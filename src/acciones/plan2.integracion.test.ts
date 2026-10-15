import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unidades, usuarios } from "@/datos/esquema";
import { operadorDePrueba, unidadDePrueba } from "@/datos/pruebas/flota-ejemplo";
import { crearBasePostgres, type BasePostgres } from "@/datos/pruebas/postgres-prueba";
import { usuarioDePrueba } from "@/datos/pruebas/usuarios-prueba";
import { cambiarActivoPorScript } from "@/seguridad/bajas-por-script";
import type { UsuarioSesion } from "@/seguridad/permisos";
import { guardarOperador, guardarUnidad, registrarEntregaAviso } from "./flota.nucleo";
import { asignarJornada } from "./jornada.nucleo";
import type { Contexto, Resultado } from "./tipos";
import { cambiarRol, crearUsuario, darDeBajaUsuario } from "./usuarios.nucleo";

const AHORA = new Date("2026-10-14T15:00:00Z");

/** Marca cuándo termina una promesa, para comprobar que espera un candado. */
function vigilar<T>(promesa: Promise<T>) {
  const estado = { terminada: false };
  const resultado = promesa.finally(() => (estado.terminada = true));
  return { estado, resultado };
}

const pausa = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

function valor<T>(r: Resultado<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.valor;
}

describe("acciones del Plan 2 con Postgres real (concurrencia)", () => {
  let base: BasePostgres;
  let despachador: UsuarioSesion;
  let admin: UsuarioSesion;
  const ctx = (usuario: UsuarioSesion = despachador): Contexto => ({ bd: base.bd, usuario, ahora: AHORA });

  beforeAll(async () => {
    base = await crearBasePostgres();
    despachador = await usuarioDePrueba(base.bd, "despachador");
    admin = await usuarioDePrueba(base.bd, "admin");
  });
  afterAll(async () => base.cerrar());

  async function versionDe(id: string): Promise<number> {
    const [fila] = await base.bd.select({ version: usuarios.version }).from(usuarios).where(eq(usuarios.id, id));
    return fila.version;
  }

  it("asignar una jornada espera a que termine la edición en curso de la unidad y revalida con lo guardado", async () => {
    const unidad = valor(await guardarUnidad(ctx(), null, null, unidadDePrueba({ placa: "CONC01" })));
    const operador = valor(await guardarOperador(ctx(), null, null, operadorDePrueba()));
    valor(await registrarEntregaAviso(ctx(), operador.id, operador.version));

    // Una edición que desactiva la unidad queda abierta sin confirmar.
    let soltar!: () => void;
    const liberada = new Promise<void>((resolver) => (soltar = resolver));
    let avisar!: () => void;
    const editada = new Promise<void>((resolver) => (avisar = resolver));
    const edicion = base.bd.transaction(async (tx) => {
      await tx.update(unidades).set({ activo: false, version: sql`${unidades.version} + 1` }).where(eq(unidades.id, unidad.id));
      avisar();
      await liberada;
    });
    await editada;

    const asignacion = vigilar(
      asignarJornada(ctx(), { fecha: "2026-10-15", unidadId: unidad.id, operadorId: operador.id, disponibleDesde: "08:00", notas: null }),
    );
    await pausa(300);
    expect(asignacion.estado.terminada).toBe(false);
    soltar();
    await edicion;
    expect(await asignacion.resultado).toMatchObject({ ok: false, error: "invalido", campos: { unidadId: [expect.stringMatching(/inactiv/i)] } });
  });

  it("degradar y dar de baja a dos administradores distintos a la vez no se bloquea mutuamente", async () => {
    for (let ronda = 0; ronda < 5; ronda++) {
      const a = await usuarioDePrueba(base.bd, "admin");
      const b = await usuarioDePrueba(base.bd, "admin");
      const [r1, r2] = await Promise.all([
        cambiarRol(ctx(admin), a.id, await versionDe(a.id), { rol: "despachador", operadorId: null }),
        darDeBajaUsuario(ctx(admin), b.id, await versionDe(b.id)),
      ]);
      expect(r1).toMatchObject({ ok: true });
      expect(r2).toMatchObject({ ok: true });
    }
  });

  it("dos administradores que se degradan uno al otro a la vez: uno gana y siempre queda un administrador activo", async () => {
    const otro = await usuarioDePrueba(base.bd, "admin");
    await base.comoAdmin(`UPDATE usuarios SET activo = false WHERE rol = 'admin' AND id NOT IN ('${admin.id}', '${otro.id}')`);
    const [r1, r2] = await Promise.all([
      cambiarRol(ctx(admin), otro.id, await versionDe(otro.id), { rol: "gerencia", operadorId: null }),
      cambiarRol(ctx(otro), admin.id, await versionDe(admin.id), { rol: "gerencia", operadorId: null }),
    ]);
    expect([r1, r2].filter((r) => r.ok)).toHaveLength(1);
    expect([r1, r2]).toContainEqual({ ok: false, error: "invalido", campos: { rol: ["Debe quedar al menos un administrador activo"] } });
    const activos = await base.bd.execute(sql`SELECT count(*)::int AS n FROM usuarios WHERE rol = 'admin' AND activo`);
    expect((activos as unknown as { rows: { n: number }[] }).rows[0].n).toBe(1);
    // Deja otra vez a admin como administrador para las pruebas siguientes.
    await base.comoAdmin(`UPDATE usuarios SET rol = 'admin', activo = true WHERE id = '${admin.id}'`);
  });

  it("la web degrada a un administrador mientras el script desactiva al otro: siempre queda uno activo", async () => {
    const otro = await usuarioDePrueba(base.bd, "admin");
    await base.comoAdmin(`UPDATE usuarios SET activo = false WHERE rol = 'admin' AND id NOT IN ('${admin.id}', '${otro.id}')`);
    const [web, script] = await Promise.all([
      cambiarRol(ctx(admin), otro.id, await versionDe(otro.id), { rol: "gerencia", operadorId: null }),
      base.bd.transaction((tx) => cambiarActivoPorScript(tx, admin.id, false, AHORA)),
    ]);
    expect([web.ok, script === "hecho"].filter(Boolean)).toHaveLength(1);
    expect(web.ok ? script : web).toEqual(web.ok ? "ultimo_admin" : { ok: false, error: "invalido", campos: { rol: ["Debe quedar al menos un administrador activo"] } });
    const activos = await base.bd.execute(sql`SELECT count(*)::int AS n FROM usuarios WHERE rol = 'admin' AND activo`);
    expect((activos as unknown as { rows: { n: number }[] }).rows[0].n).toBe(1);
    await base.comoAdmin(`UPDATE usuarios SET rol = 'admin', activo = true WHERE id = '${admin.id}'`);
  });

  it("dos altas simultáneas con el mismo correo: una crea la cuenta y la otra responde correo repetido", async () => {
    const entrada = { correo: "repetido@prueba.local", nombre: "Persona Repetida", rol: "despachador", operadorId: null };
    const resultados = await Promise.all([crearUsuario(ctx(admin), entrada), crearUsuario(ctx(admin), entrada)]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados).toContainEqual({ ok: false, error: "invalido", campos: { correo: ["Ya hay una cuenta con ese correo"] } });
  });
});
