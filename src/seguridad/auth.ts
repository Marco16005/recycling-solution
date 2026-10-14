import "server-only";
import { bdDeLaAplicacion } from "@/datos/conexion";
import { crearAuth, type Auth } from "./auth-base";

let auth: Auth | null = null;

/** Instancia de la aplicación. Se crea al primer uso para que el build no necesite secretos. */
export function authDeLaAplicacion(): Auth {
  auth ??= crearAuth(bdDeLaAplicacion(), {
    secreto: process.env.BETTER_AUTH_SECRET ?? "",
    url: process.env.BETTER_AUTH_URL ?? "",
    limitarIntentos: process.env.AUTH_LIMITAR_INTENTOS !== "no",
  });
  return auth;
}
