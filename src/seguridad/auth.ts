import "server-only";
import { bdDeLaAplicacion } from "@/datos/conexion";
import { crearAuth, type Autenticacion } from "./auth-base";

let autenticacion: Autenticacion | null = null;

/** Instancia de la aplicación. Se crea al primer uso para que el build no necesite secretos. */
function deLaAplicacion(): Autenticacion {
  autenticacion ??= crearAuth(bdDeLaAplicacion(), {
    secreto: process.env.BETTER_AUTH_SECRET ?? "",
    url: process.env.BETTER_AUTH_URL ?? "",
    limitarIntentos: process.env.AUTH_LIMITAR_INTENTOS !== "no",
  });
  return autenticacion;
}

/** Para leer la sesión en el servidor (auth.api.getSession). */
export const authDeLaAplicacion = () => deLaAplicacion().auth;

/** Para la ruta /api/auth: toda petición HTTP a Better Auth pasa por aquí. */
export const manejarPeticionDeAuth = (peticion: Request) => deLaAplicacion().manejar(peticion);
