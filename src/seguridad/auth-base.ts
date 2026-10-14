import { AsyncLocalStorage } from "node:async_hooks";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import type { BD } from "@/datos/bd";
import { session, user, usuarios } from "@/datos/esquema";
import * as esquemaAuth from "@/datos/esquema-auth";
import { correoNormalizado } from "./identidades";

export interface OpcionesAuth {
  secreto: string;
  /** URL pública de la aplicación, p. ej. https://rs.ejemplo.mx */
  url: string;
  /** Límite de intentos por IP. Solo se apaga en las pruebas de punta a punta, que entran muchas veces desde una sola IP. */
  limitarIntentos: boolean;
  /** Solo para pruebas: pausas dentro de la creación de la sesión, para forzar cruces con bajas y restablecimientos. */
  pruebas?: { antesDeRevisar?: () => Promise<void>; despuesDeRevisar?: () => Promise<void> };
}

/** Entradas por IP por minuto. Detrás de Caddy, la IP es la del cliente (X-Forwarded-For que pone el proxy). */
const INTENTOS_DE_ENTRADA_POR_MINUTO = 5;

/** Generación de credenciales del usuario leída al empezar la petición, antes de que Better Auth verifique la contraseña. */
interface EntradaEnCurso {
  generacion: number | null;
}

const entradaEnCurso = new AsyncLocalStorage<EntradaEnCurso>();

async function estadoPorIdentidad(bd: BD, authUserId: string) {
  const [fila] = await bd
    .select({ activo: usuarios.activo, generacion: usuarios.generacion })
    .from(usuarios)
    .where(eq(usuarios.authUserId, authUserId))
    .limit(1);
  return fila ?? null;
}

async function generacionPorCorreo(bd: BD, correo: unknown): Promise<number | null> {
  if (typeof correo !== "string") return null;
  const [fila] = await bd
    .select({ generacion: usuarios.generacion })
    .from(user)
    .innerJoin(usuarios, eq(usuarios.authUserId, user.id))
    .where(eq(user.email, correoNormalizado(correo)))
    .limit(1);
  return fila?.generacion ?? null;
}

/** La sesión vale si el usuario está activo y nada cambió sus credenciales desde que empezó la petición de entrada. */
async function sesionPermitida(bd: BD, authUserId: string): Promise<boolean> {
  const inicio = entradaEnCurso.getStore();
  const actual = await estadoPorIdentidad(bd, authUserId);
  return actual !== null && actual.activo && inicio !== undefined && inicio.generacion === actual.generacion;
}

/**
 * Better Auth solo autentica: correo y contraseña, sin registro público. Las sesiones se crean solo a través de
 * `manejar`, que fija la generación de credenciales antes de verificar la contraseña. La creación de la sesión se
 * revisa dos veces: antes de guardarla (se niega) y después (se borra), porque Better Auth verifica la contraseña y
 * guarda la sesión en pasos separados y una baja o un restablecimiento puede ocurrir entre ellos.
 */
export function crearAuth(bd: BD, opciones: OpcionesAuth) {
  const auth = betterAuth({
    secret: opciones.secreto,
    baseURL: opciones.url,
    trustedOrigins: [opciones.url],
    database: drizzleAdapter(bd, { provider: "pg", schema: esquemaAuth }),
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 10 },
    rateLimit: {
      enabled: opciones.limitarIntentos,
      window: 60,
      max: 100,
      customRules: { "/sign-in/email": { window: 60, max: INTENTOS_DE_ENTRADA_POR_MINUTO } },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (nueva) => {
            await opciones.pruebas?.antesDeRevisar?.();
            const permitida = await sesionPermitida(bd, nueva.userId);
            await opciones.pruebas?.despuesDeRevisar?.();
            return permitida ? undefined : false;
          },
          after: async (creada) => {
            if (!(await sesionPermitida(bd, creada.userId))) await bd.delete(session).where(eq(session.id, creada.id));
          },
        },
      },
    },
    plugins: [nextCookies()],
  });

  /** Única entrada HTTP a Better Auth (la usa la ruta /api/auth). */
  async function manejar(peticion: Request): Promise<Response> {
    const esEntrada = peticion.method === "POST" && new URL(peticion.url).pathname.endsWith("/sign-in/email");
    const cuerpo = esEntrada ? await peticion.clone().json().catch(() => null) : null;
    const generacion = esEntrada ? await generacionPorCorreo(bd, cuerpo?.email) : null;
    return entradaEnCurso.run({ generacion }, () => auth.handler(peticion));
  }

  return { auth, manejar };
}

export type Autenticacion = ReturnType<typeof crearAuth>;
export type Auth = Autenticacion["auth"];
