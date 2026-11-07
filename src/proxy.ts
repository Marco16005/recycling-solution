import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { encabezadosDinamicos } from "@/seguridad/encabezados";

const PROTEGIDAS = ["/despacho", "/operador", "/gerencia", "/admin", "/cuenta"];

/**
 * Revisión optimista: sin cookie de sesión, a /entrar. No valida la sesión ni el rol;
 * eso lo hacen las consultas y acciones en el servidor.
 *
 * Plan de seguridad (S5): además pone en cada página la política de contenido y, con https, HSTS. Se arman aquí y no
 * en next.config.ts porque dependen de MAPA_ESTILO_URL y BETTER_AUTH_URL, que se fijan al arrancar el contenedor.
 */
export function proxy(peticion: NextRequest) {
  const ruta = peticion.nextUrl.pathname;
  const protegida = PROTEGIDAS.some((p) => ruta === p || ruta.startsWith(`${p}/`));
  const respuesta = protegida && !getSessionCookie(peticion)
    ? NextResponse.redirect(new URL("/entrar", peticion.url))
    : NextResponse.next();
  for (const [nombre, valor] of encabezadosDinamicos(process.env)) respuesta.headers.set(nombre, valor);
  return respuesta;
}

export const config = {
  // Todo menos los archivos estáticos que sirve Next; esos llevan los encabezados fijos de next.config.ts.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|maplibre-gl-worker.mjs).*)"],
};
