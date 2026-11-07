import { verifyPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { BD } from "@/datos/bd";
import { account, bitacora, session, usuarios } from "@/datos/esquema";
import { crearBdPrueba } from "@/datos/pruebas/bd-prueba";
import { usuarioDePrueba } from "@/datos/pruebas/usuarios-prueba";
import { buscarPorCorreo } from "@/seguridad/identidades";
import { MENSAJE_LIMITE } from "@/seguridad/limites";
import type { UsuarioSesion } from "@/seguridad/permisos";
import { cambiarMiClave } from "./cuenta.nucleo";
import type { Contexto } from "./tipos";
import { crearUsuario, darDeBajaUsuario, MENSAJE_RESTABLECER_PROPIA, restablecerClaveDeUsuario } from "./usuarios.nucleo";

const AHORA = new Date("2026-11-07T15:00:00Z");
const VIGENTE = new Date("2026-12-01T00:00:00Z");
const NUEVA = "mi-clave-nueva-2026";

/** Diseño del 2026-11-07: cambio de contraseña propio, temporales obligatorias y restablecer a uno mismo. */
describe("mi contraseña", () => {
  let bd: BD;
  let admin: UsuarioSesion;
  let yo: UsuarioSesion;
  let temporal: string;
  let authUserId: string;
  const ctx = (usuario: UsuarioSesion | null): Contexto => ({ bd, usuario, ahora: AHORA });
  const cambio = (actual: string, nueva = NUEVA, confirmacion = nueva) => ({ actual, nueva, confirmacion });
  const hashActual = async () =>
    (await bd.select({ p: account.password }).from(account).where(and(eq(account.userId, authUserId), eq(account.providerId, "credential"))))[0].p!;
  const sesiones = async () => (await bd.select({ id: session.id }).from(session).where(eq(session.userId, authUserId))).map((s) => s.id).sort();
  const fila = async () => (await bd.select().from(usuarios).where(eq(usuarios.id, yo.id)))[0];
  const eventos = async () => bd.select().from(bitacora).where(and(eq(bitacora.entidadId, yo.id), eq(bitacora.accion, "cambiar_clave")));

  beforeEach(async () => {
    bd = await crearBdPrueba();
    admin = await usuarioDePrueba(bd, "admin");
    const alta = await crearUsuario(ctx(admin), { correo: "dora@empresa.mx", nombre: "Dora", rol: "despachador", operadorId: null });
    if (!alta.ok) throw new Error("alta");
    temporal = alta.valor.claveTemporal;
    authUserId = (await buscarPorCorreo(bd, "dora@empresa.mx"))!.authUserId;
    yo = { id: alta.valor.id, nombre: "Dora", rol: "despachador", activo: true, debeCambiarClave: true };
    await bd.insert(session).values([
      { id: "actual", token: "t-actual", userId: authUserId, expiresAt: VIGENTE, updatedAt: AHORA },
      { id: "otra", token: "t-otra", userId: authUserId, expiresAt: VIGENTE, updatedAt: AHORA },
    ]);
  });

  it("el alta desde la aplicación deja la contraseña como temporal", async () => {
    expect((await fila()).debeCambiarClave).toBe(true);
  });

  it("con la actual correcta: cambia el hash, conserva esta sesión, cierra las otras y lo deja en la bitácora", async () => {
    const generacion = (await fila()).generacion;
    expect(await cambiarMiClave(ctx(yo), "actual", cambio(temporal))).toEqual({ ok: true, valor: { obligatorio: true } });
    const hash = await hashActual();
    expect(await verifyPassword({ hash, password: NUEVA })).toBe(true);
    expect(await verifyPassword({ hash, password: temporal })).toBe(false);
    expect(await sesiones()).toEqual(["actual"]);
    expect(await fila()).toMatchObject({ debeCambiarClave: false, generacion: generacion + 1, version: 1 });
    expect(await eventos()).toEqual([expect.objectContaining({ usuarioId: yo.id, entidad: "usuario", campos: ["clave"] })]);

    // Ya sin temporal: un segundo cambio no es obligatorio.
    const libre = { ...yo, debeCambiarClave: false };
    expect(await cambiarMiClave(ctx(libre), "actual", cambio(NUEVA, "otra-clave-larga-99"))).toEqual({ ok: true, valor: { obligatorio: false } });
  });

  it("con la actual equivocada no escribe nada", async () => {
    const antes = { hash: await hashActual(), fila: await fila() };
    expect(await cambiarMiClave(ctx(yo), "actual", cambio("no-es-la-mia-123"))).toEqual({
      ok: false, error: "invalido", campos: { actual: ["La contraseña actual no es correcta"] },
    });
    expect(await hashActual()).toBe(antes.hash);
    expect(await fila()).toEqual(antes.fila);
    expect(await sesiones()).toEqual(["actual", "otra"]);
    expect(await eventos()).toEqual([]);
  });

  it("valida largo, confirmación y que la nueva sea distinta", async () => {
    const campos = async (entrada: unknown) => {
      const r = await cambiarMiClave(ctx(yo), "actual", entrada);
      return r.ok || r.error !== "invalido" ? r : Object.keys(r.campos).sort();
    };
    expect(await campos(cambio(temporal, "corta"))).toEqual(["nueva"]);
    expect(await campos(cambio(temporal, "x".repeat(129)))).toEqual(["nueva"]);
    expect(await campos(cambio(temporal, NUEVA, "otra-cosa-123"))).toEqual(["confirmacion"]);
    expect(await campos(cambio(temporal, temporal))).toEqual(["nueva"]);
    expect(await campos(cambio(""))).toEqual(["actual"]);
    expect(await campos({ actual: 1 })).toEqual(["actual", "confirmacion", "nueva"]);
    expect(await hashActual()).not.toBe("");
    expect(await eventos()).toEqual([]);
  });

  it("sin sesión viva, inactivo o sin permiso no escribe nada", async () => {
    expect(await cambiarMiClave(ctx(null), "actual", cambio(temporal))).toEqual({ ok: false, error: "no_autenticado" });
    expect(await cambiarMiClave(ctx(yo), null, cambio(temporal))).toEqual({ ok: false, error: "no_autenticado" });
    // Una sesión que no existe, de otro usuario o caducada.
    expect(await cambiarMiClave(ctx(yo), "no-existe", cambio(temporal))).toEqual({ ok: false, error: "no_autenticado" });
    await bd.insert(session).values({ id: "caducada", token: "t-cad", userId: authUserId, expiresAt: new Date("2026-11-01T00:00:00Z"), updatedAt: AHORA });
    expect(await cambiarMiClave(ctx(yo), "caducada", cambio(temporal))).toEqual({ ok: false, error: "no_autenticado" });
    // La baja llegó mientras la acción esperaba: el contexto aún dice activo, la base ya no.
    expect((await darDeBajaUsuario(ctx(admin), yo.id, 1)).ok).toBe(true);
    expect(await cambiarMiClave(ctx(yo), "actual", cambio(temporal))).toEqual({ ok: false, error: "no_autenticado" });
    expect(await verifyPassword({ hash: await hashActual(), password: temporal })).toBe(true);
    expect(await eventos()).toEqual([]);
  });

  it("con el límite encendido, el sexto intento en un minuto se rechaza sin verificar", async () => {
    const anterior = process.env.LIMITAR_ACCIONES;
    process.env.LIMITAR_ACCIONES = "si";
    try {
      for (let i = 0; i < 5; i++) {
        expect(await cambiarMiClave(ctx(yo), "actual", cambio("no-es-la-mia-123"))).toMatchObject({ error: "invalido", campos: { actual: expect.any(Array) } });
      }
      expect(await cambiarMiClave(ctx(yo), "actual", cambio(temporal))).toEqual({ ok: false, error: "invalido", campos: { _: [MENSAJE_LIMITE] } });
      expect(await verifyPassword({ hash: await hashActual(), password: temporal })).toBe(true);
    } finally {
      if (anterior === undefined) delete process.env.LIMITAR_ACCIONES;
      else process.env.LIMITAR_ACCIONES = anterior;
    }
  });

  it("el administrador no se restablece a sí mismo; a otro sí, y le vuelve a pedir el cambio", async () => {
    expect(await restablecerClaveDeUsuario(ctx(admin), admin.id, 1)).toEqual({ ok: false, error: "invalido", campos: { _: [MENSAJE_RESTABLECER_PROPIA] } });
    expect(await cambiarMiClave(ctx(yo), "actual", cambio(temporal))).toMatchObject({ ok: true });
    expect((await fila()).debeCambiarClave).toBe(false);
    const r = await restablecerClaveDeUsuario(ctx(admin), yo.id, 1);
    expect(r).toMatchObject({ ok: true, valor: { version: 2 } });
    expect(await fila()).toMatchObject({ debeCambiarClave: true });
    expect(await sesiones()).toEqual([]);
  });
});
