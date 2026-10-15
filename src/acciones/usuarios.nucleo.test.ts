import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { listarUsuarios } from "@/consultas/usuarios.nucleo";
import type { BD } from "@/datos/bd";
import { operadores, session, usuarios } from "@/datos/esquema";
import { crearBdPrueba } from "@/datos/pruebas/bd-prueba";
import { usuarioDePrueba } from "@/datos/pruebas/usuarios-prueba";
import { buscarPorCorreo } from "@/seguridad/identidades";
import type { UsuarioSesion } from "@/seguridad/permisos";
import { guardarConfiguracion } from "./configuracion.nucleo";
import { cambiarRol, crearUsuario, darDeBajaUsuario, reactivarCuenta, restablecerClaveDeUsuario } from "./usuarios.nucleo";
import type { Contexto } from "./tipos";

const AHORA = new Date("2026-10-14T15:00:00Z");

describe("administración de usuarios y configuración", () => {
  let bd: BD;
  let admin: UsuarioSesion;
  const ctx = (usuario: UsuarioSesion | null = admin): Contexto => ({ bd, usuario, ahora: AHORA });

  beforeEach(async () => {
    bd = await crearBdPrueba();
    admin = await usuarioDePrueba(bd, "admin");
  });

  it("solo admin gestiona usuarios", async () => {
    const despachador = await usuarioDePrueba(bd, "despachador");
    expect(await listarUsuarios(ctx(despachador))).toEqual({ ok: false, error: "no_autorizado" });
    expect(await crearUsuario(ctx(despachador), {})).toEqual({ ok: false, error: "no_autorizado" });
  });

  it("crea con clave temporal; el correo es único y el operador exige ficha libre", async () => {
    const r = await crearUsuario(ctx(), { correo: "Ana@Empresa.mx", nombre: "Ana", rol: "despachador", operadorId: null });
    expect(r).toMatchObject({ ok: true, valor: { claveTemporal: expect.stringMatching(/^[A-Za-z0-9]{20}$/) } });
    expect(await crearUsuario(ctx(), { correo: "ana@empresa.mx", nombre: "Ana 2", rol: "despachador", operadorId: null })).toMatchObject({ ok: false, error: "invalido", campos: { correo: expect.any(Array) } });
    expect(await crearUsuario(ctx(), { correo: "op@operadores.local", nombre: "Op", rol: "operador", operadorId: null })).toMatchObject({ ok: false, error: "invalido", campos: { operadorId: expect.any(Array) } });
    const [ficha] = await bd.insert(operadores).values({ nombre: "Op" }).returning();
    expect((await crearUsuario(ctx(), { correo: "op@operadores.local", nombre: "Op", rol: "operador", operadorId: ficha.id })).ok).toBe(true);
    expect(await crearUsuario(ctx(), { correo: "op2@operadores.local", nombre: "Op2", rol: "operador", operadorId: ficha.id })).toMatchObject({ ok: false, error: "invalido", campos: { operadorId: expect.any(Array) } });
  });

  it("cambiar el rol sube versión y generación y cierra sus sesiones; no a uno mismo ni al último admin", async () => {
    const r = await crearUsuario(ctx(), { correo: "ger@empresa.mx", nombre: "Ger", rol: "gerencia", operadorId: null });
    if (!r.ok) throw new Error("alta");
    const { authUserId } = (await buscarPorCorreo(bd, "ger@empresa.mx"))!;
    await bd.insert(session).values({ id: "s1", token: "t1", userId: authUserId, expiresAt: new Date("2026-12-01T00:00:00Z"), updatedAt: AHORA });
    expect(await cambiarRol(ctx(), r.valor.id, 1, { rol: "despachador", operadorId: null })).toEqual({ ok: true, valor: { version: 2 } });
    expect(await bd.select().from(session)).toEqual([]);
    const [u] = await bd.select().from(usuarios).where(eq(usuarios.id, r.valor.id));
    expect(u).toMatchObject({ rol: "despachador", generacion: 2, version: 2 });
    expect(await cambiarRol(ctx(), r.valor.id, 1, { rol: "gerencia", operadorId: null })).toEqual({ ok: false, error: "conflicto" });
    expect(await cambiarRol(ctx(), admin.id, 1, { rol: "despachador", operadorId: null })).toMatchObject({ ok: false, error: "invalido" });
    expect(await darDeBajaUsuario(ctx(), admin.id, 1)).toMatchObject({ ok: false, error: "invalido" });
  });

  it("baja, reactivación y restablecimiento devuelven la versión nueva", async () => {
    const r = await crearUsuario(ctx(), { correo: "d@empresa.mx", nombre: "Dora", rol: "despachador", operadorId: null });
    if (!r.ok) throw new Error("alta");
    expect(await darDeBajaUsuario(ctx(), r.valor.id, 1)).toEqual({ ok: true, valor: { version: 2 } });
    expect(await reactivarCuenta(ctx(), r.valor.id, 2)).toEqual({ ok: true, valor: { version: 3 } });
    expect(await restablecerClaveDeUsuario(ctx(), r.valor.id, 3)).toMatchObject({ ok: true, valor: { version: 4, claveTemporal: expect.any(String) } });
  });

  it("la configuración se guarda con versión y valida el turno y los días", async () => {
    const base = {
      patioLat: 20.62, patioLng: -100.29, turnoInicio: "07:00", turnoFin: "15:00", velocidadKmh: 28, factorCircuidad: 1.35,
      descargaMin: 25, cargaPorOmisionKg: 1200, diasOperacion: [6, 1, 2, 3, 4, 5], diasParaAtrasada: 2,
    };
    expect(await guardarConfiguracion(ctx(), 1, base)).toEqual({ ok: true, valor: { version: 2 } });
    expect(await guardarConfiguracion(ctx(), 1, base)).toEqual({ ok: false, error: "conflicto" });
    expect(await guardarConfiguracion(ctx(), 2, { ...base, turnoFin: "06:00" })).toMatchObject({ ok: false, error: "invalido", campos: { turnoFin: expect.any(Array) } });
    expect(await guardarConfiguracion(ctx(await usuarioDePrueba(bd, "despachador")), 2, base)).toEqual({ ok: false, error: "no_autorizado" });
  });
});
