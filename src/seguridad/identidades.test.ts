import { verifyPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { BD } from "@/datos/bd";
import { account, bitacora, session, user, usuarios } from "@/datos/esquema";
import { crearBdPrueba } from "@/datos/pruebas/bd-prueba";
import { asegurarAdministrador } from "./bootstrap";
import { buscarPorCorreo, crearIdentidad, desactivarUsuario, reactivarUsuario, restablecerClave } from "./identidades";

const AHORA = new Date("2026-10-13T15:00:00Z");
const DESPACHADOR = { correo: "Despacho@Prueba.local ", nombre: "Ana Despacho", clave: "clave-larga-123", rol: "despachador" as const };

async function claveGuardada(bd: BD, correo: string): Promise<string> {
  const existente = await buscarPorCorreo(bd, correo);
  const [fila] = await bd.select({ password: account.password }).from(account).where(eq(account.userId, existente!.authUserId));
  return fila.password!;
}

async function sesionFalsa(bd: BD, authUserId: string): Promise<void> {
  await bd.insert(session).values({ id: crypto.randomUUID(), token: crypto.randomUUID(), userId: authUserId, expiresAt: new Date("2026-12-01T00:00:00Z"), updatedAt: AHORA });
}

describe("identidades", () => {
  let bd: BD;
  beforeEach(async () => {
    bd = await crearBdPrueba();
  });

  it("crea identidad, credencial, usuario y bitácora; el correo se guarda normalizado", async () => {
    const { usuarioId } = await bd.transaction((tx) => crearIdentidad(tx, DESPACHADOR, null, AHORA));
    const existente = await buscarPorCorreo(bd, "despacho@prueba.local");
    expect(existente).toMatchObject({ usuarioId, rol: "despachador", activo: true });
    expect(await verifyPassword({ hash: await claveGuardada(bd, "despacho@prueba.local"), password: DESPACHADOR.clave })).toBe(true);
    const eventos = await bd.select().from(bitacora);
    expect(eventos).toEqual([expect.objectContaining({ entidad: "usuario", entidadId: usuarioId, accion: "crear_por_script", campos: ["correo", "nombre", "rol", "clave"] })]);
    expect(JSON.stringify(eventos)).not.toContain(DESPACHADOR.clave);
  });

  it("si la transacción falla después de crear todo, no queda nada", async () => {
    await expect(
      bd.transaction(async (tx) => {
        await crearIdentidad(tx, DESPACHADOR, null, AHORA);
        throw new Error("falla posterior");
      }),
    ).rejects.toThrow("falla posterior");
    for (const tabla of [user, account, usuarios, bitacora]) expect(await bd.select().from(tabla)).toEqual([]);
  });

  it("rechaza contraseñas cortas y correos repetidos", async () => {
    await expect(bd.transaction((tx) => crearIdentidad(tx, { ...DESPACHADOR, clave: "corta" }, null, AHORA))).rejects.toThrow(/entre 10 y 128/);
    await bd.transaction((tx) => crearIdentidad(tx, DESPACHADOR, null, AHORA));
    await expect(bd.transaction((tx) => crearIdentidad(tx, { ...DESPACHADOR, correo: "despacho@prueba.local" }, null, AHORA))).rejects.toThrow();
  });

  it("desactivar borra sus sesiones; reactivar no las revive", async () => {
    const { usuarioId } = await bd.transaction((tx) => crearIdentidad(tx, DESPACHADOR, null, AHORA));
    const { authUserId } = (await buscarPorCorreo(bd, DESPACHADOR.correo))!;
    await sesionFalsa(bd, authUserId);
    expect(await bd.transaction((tx) => desactivarUsuario(tx, usuarioId, null, AHORA))).toBe(true);
    expect(await bd.select().from(session)).toEqual([]);
    expect((await buscarPorCorreo(bd, DESPACHADOR.correo))?.activo).toBe(false);
    expect(await bd.transaction((tx) => reactivarUsuario(tx, usuarioId, null, AHORA))).toBe(true);
    expect(await bd.select().from(session)).toEqual([]);
    expect((await buscarPorCorreo(bd, DESPACHADOR.correo))?.activo).toBe(true);
  });

  it("restablecer la contraseña cambia el hash y cierra las sesiones", async () => {
    const { usuarioId } = await bd.transaction((tx) => crearIdentidad(tx, DESPACHADOR, null, AHORA));
    const { authUserId } = (await buscarPorCorreo(bd, DESPACHADOR.correo))!;
    await sesionFalsa(bd, authUserId);
    expect(await bd.transaction((tx) => restablecerClave(tx, usuarioId, "otra-clave-larga-456", null, AHORA))).toBe(true);
    const hash = await claveGuardada(bd, DESPACHADOR.correo);
    expect(await verifyPassword({ hash, password: "otra-clave-larga-456" })).toBe(true);
    expect(await verifyPassword({ hash, password: DESPACHADOR.clave })).toBe(false);
    expect(await bd.select().from(session)).toEqual([]);
  });

  it("con un usuario inexistente devuelven false", async () => {
    const nadie = "00000000-0000-4000-8000-000000000000";
    expect(await bd.transaction((tx) => desactivarUsuario(tx, nadie, null, AHORA))).toBe(false);
    expect(await bd.transaction((tx) => restablecerClave(tx, nadie, "otra-clave-larga-456", null, AHORA))).toBe(false);
  });
});

describe("bootstrap del primer administrador", () => {
  let bd: BD;
  beforeEach(async () => {
    bd = await crearBdPrueba();
  });

  const ADMIN = { correo: "admin@prueba.local", nombre: "Admin", clave: "clave-admin-123" };

  it("dos ejecuciones dejan un solo administrador y no cambian su contraseña", async () => {
    expect(await asegurarAdministrador(bd, ADMIN, AHORA)).toBe("creado");
    const hash = await claveGuardada(bd, ADMIN.correo);
    expect(await asegurarAdministrador(bd, { ...ADMIN, clave: "otra-clave-distinta" }, AHORA)).toBe("ya_existe");
    expect(await claveGuardada(bd, ADMIN.correo)).toBe(hash);
    expect(await bd.select().from(usuarios)).toHaveLength(1);
  });

  it("no promueve a una cuenta existente con otro rol", async () => {
    await bd.transaction((tx) => crearIdentidad(tx, { ...DESPACHADOR, correo: ADMIN.correo }, null, AHORA));
    await expect(asegurarAdministrador(bd, ADMIN, AHORA)).rejects.toThrow(/no la promueve/);
    expect((await buscarPorCorreo(bd, ADMIN.correo))?.rol).toBe("despachador");
  });

  it("no completa una identidad sin usuario de la aplicación", async () => {
    await bd.insert(user).values({ id: "huerfana", name: "Huérfana", email: ADMIN.correo, emailVerified: true });
    await expect(asegurarAdministrador(bd, ADMIN, AHORA)).rejects.toThrow(/sin usuario de la aplicación/);
    expect(await bd.select().from(usuarios)).toEqual([]);
  });
});
