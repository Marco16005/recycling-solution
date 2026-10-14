import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Revisión optimista: sin cookie de sesión, a /entrar. No valida la sesión ni el rol;
 * eso lo hacen las consultas y acciones en el servidor.
 */
export function proxy(peticion: NextRequest) {
  if (!getSessionCookie(peticion)) return NextResponse.redirect(new URL("/entrar", peticion.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/despacho/:path*", "/operador/:path*", "/gerencia/:path*"],
};
