import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import type { BD } from "@/datos/bd";
import { usuarios } from "@/datos/esquema";
import * as esquemaAuth from "@/datos/esquema-auth";

export interface OpcionesAuth {
  secreto: string;
  /** URL pública de la aplicación, p. ej. https://rs.ejemplo.mx */
  url: string;
  /** Límite de intentos por IP. Solo se apaga en las pruebas de punta a punta, que entran muchas veces desde una sola IP. */
  limitarIntentos: boolean;
}

/** Entradas por IP por minuto. Detrás de Caddy, la IP es la del cliente (X-Forwarded-For que pone el proxy). */
const INTENTOS_DE_ENTRADA_POR_MINUTO = 5;

/**
 * Better Auth solo autentica: correo y contraseña, sin registro público.
 * Niega la sesión a quien no tenga un renglón activo en `usuarios` (la única fuente de autorización).
 */
export function crearAuth(bd: BD, opciones: OpcionesAuth) {
  return betterAuth({
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
          before: async (sesion) => {
            const [fila] = await bd
              .select({ activo: usuarios.activo })
              .from(usuarios)
              .where(eq(usuarios.authUserId, sesion.userId))
              .limit(1);
            return fila?.activo ? undefined : false;
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof crearAuth>;
