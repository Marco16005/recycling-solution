import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { account, bitacora, session, user, usuarios } from "@/datos/esquema";
import { crearBasePostgres, type BasePostgres } from "@/datos/pruebas/postgres-prueba";
import { crearAuth, type Auth } from "./auth-base";
import { buscarPorCorreo, crearIdentidad, desactivarUsuario, reactivarUsuario, restablecerClave } from "./identidades";

const URL_APP = "http://localhost:3000";
const AHORA = new Date("2026-10-13T15:00:00Z");
const CLAVE = "clave-larga-123";

/**
 * Comprueba contra Better Auth 1.7.7 real (con Postgres) que las identidades creadas por `identidades.ts` funcionan
 * y que los cierres de acceso surten efecto. Repetir al actualizar Better Auth.
 */
describe("autenticación con Better Auth y Postgres real", () => {
  let base: BasePostgres;
  let auth: Auth;

  const peticion = (ruta: string, cuerpo: unknown) =>
    auth.handler(
      new Request(`${URL_APP}/api/auth/${ruta}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: URL_APP },
        body: JSON.stringify(cuerpo),
      }),
    );
  const entrar = (email: string, password = CLAVE) => peticion("sign-in/email", { email, password });
  const cookieDe = (respuesta: Response) => (respuesta.headers.get("set-cookie") ?? "").split(";")[0];
  const sesionCon = (cookie: string) => auth.api.getSession({ headers: new Headers({ cookie }) });

  async function alta(correo: string, rol: "despachador" | "gerencia" = "despachador") {
    return base.bd.transaction((tx) => crearIdentidad(tx, { correo, nombre: "Prueba", clave: CLAVE, rol }, null, AHORA));
  }

  beforeAll(async () => {
    base = await crearBasePostgres();
    auth = crearAuth(base.bd, { secreto: "secreto-de-prueba-de-al-menos-32-caracteres", url: URL_APP, limitarIntentos: false });
  });
  afterAll(async () => base.cerrar());

  it("el registro público está cerrado", async () => {
    const r = await peticion("sign-up/email", { email: "nuevo@prueba.local", password: CLAVE, name: "Nuevo" });
    expect(r.status).toBe(400);
    expect(await buscarPorCorreo(base.bd, "nuevo@prueba.local")).toBeNull();
  });

  it("un usuario creado por identidades.ts entra; con la contraseña equivocada no", async () => {
    await alta("entra@prueba.local");
    const bien = await entrar("entra@prueba.local");
    expect(bien.status).toBe(200);
    expect(await sesionCon(cookieDe(bien))).toMatchObject({ user: { email: "entra@prueba.local" } });
    expect((await entrar("entra@prueba.local", "otra-clave-mala")).status).toBe(401);
  });

  it("una cookie falsificada o una sesión caducada no dan acceso", async () => {
    expect(await sesionCon("better-auth.session_token=falsa.firma")).toBeNull();
    await alta("caduca@prueba.local");
    const cookie = cookieDe(await entrar("caduca@prueba.local"));
    const { authUserId } = (await buscarPorCorreo(base.bd, "caduca@prueba.local"))!;
    await base.bd.update(session).set({ expiresAt: new Date("2020-01-01T00:00:00Z") }).where(eq(session.userId, authUserId));
    expect(await sesionCon(cookie)).toBeNull();
  });

  it("una identidad sin usuario de la aplicación no puede crear sesión", async () => {
    const { authUserId } = (await buscarPorCorreo(base.bd, "entra@prueba.local"))!;
    // Identidad huérfana armada a mano con la misma credencial que una válida.
    const [credencial] = await base.bd.select().from(account).where(eq(account.userId, authUserId));
    await base.bd.insert(user).values({ id: "huerfana", name: "Huérfana", email: "huerfana@prueba.local", emailVerified: true });
    await base.bd.insert(account).values({ ...credencial, id: "cuenta-huerfana", accountId: "huerfana", userId: "huerfana" });
    expect((await entrar("huerfana@prueba.local")).status).toBe(401);
  });

  it("desactivar cierra sus sesiones e impide entrar; reactivar no revive las sesiones anteriores", async () => {
    const { usuarioId } = await alta("baja@prueba.local");
    const cookie = cookieDe(await entrar("baja@prueba.local"));
    expect(await sesionCon(cookie)).not.toBeNull();

    await base.bd.transaction((tx) => desactivarUsuario(tx, usuarioId, null, AHORA));
    expect(await sesionCon(cookie)).toBeNull();
    expect((await entrar("baja@prueba.local")).status).toBe(401);

    await base.bd.transaction((tx) => reactivarUsuario(tx, usuarioId, null, AHORA));
    expect(await sesionCon(cookie)).toBeNull();
    expect((await entrar("baja@prueba.local")).status).toBe(200);
  });

  it("restablecer la contraseña invalida la anterior y sus sesiones", async () => {
    const { usuarioId } = await alta("olvido@prueba.local");
    const cookie = cookieDe(await entrar("olvido@prueba.local"));
    await base.bd.transaction((tx) => restablecerClave(tx, usuarioId, "clave-nueva-456", null, AHORA));
    expect(await sesionCon(cookie)).toBeNull();
    expect((await entrar("olvido@prueba.local")).status).toBe(401);
    expect((await entrar("olvido@prueba.local", "clave-nueva-456")).status).toBe(200);
  });

  it("con el límite activo, el sexto intento de entrada en un minuto desde la misma IP responde 429", async () => {
    const limitada = crearAuth(base.bd, { secreto: "secreto-de-prueba-de-al-menos-32-caracteres", url: URL_APP, limitarIntentos: true });
    const intento = () =>
      limitada.handler(
        new Request(`${URL_APP}/api/auth/sign-in/email`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: URL_APP, "x-forwarded-for": "10.0.0.7" },
          body: JSON.stringify({ email: "nadie@prueba.local", password: "clave-equivocada" }),
        }),
      );
    const estados: number[] = [];
    for (let i = 0; i < 6; i++) estados.push((await intento()).status);
    expect(estados.slice(0, 5).every((e) => e === 401)).toBe(true);
    expect(estados[5]).toBe(429);
  });

  it.each(["account", "usuarios", "bitacora"])("si falla la inserción en %s, el alta no deja nada", async (tabla) => {
    const correo = `falla-${tabla}@prueba.local`;
    await base.comoAdmin(`REVOKE INSERT ON ${tabla} FROM rs_app`);
    try {
      await expect(alta(correo)).rejects.toThrow();
    } finally {
      await base.comoAdmin(`GRANT INSERT ON ${tabla} TO rs_app`);
    }
    expect(await buscarPorCorreo(base.bd, correo)).toBeNull();
    const eventos = await base.bd.select().from(bitacora).where(eq(bitacora.entidad, "usuario"));
    const usuariosVivos = await base.bd.select({ id: usuarios.id }).from(usuarios);
    expect(eventos.every((e) => usuariosVivos.some((u) => u.id === e.entidadId))).toBe(true);
  });
});
