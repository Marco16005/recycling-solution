/**
 * Las únicas rutas de Better Auth que usa la aplicación (diseño del 2026-11-07, §2.4). Las demás, como
 * /change-password, /update-user o /revoke-sessions, escribirían en las tablas de autenticación sin bitácora y sin
 * subir la generación; los cambios de credenciales van por `identidades.ts`.
 *
 * Coincidencia exacta de método y ruta, sin normalizar nada: una barra de más, mayúsculas o una codificación no pasan
 * (revisión de Codex, 2026-11-07).
 */
export const RUTAS_DE_AUTH = ["POST /sign-in/email", "POST /sign-out", "GET /get-session"] as const;

const PREFIJO_AUTH = "/api/auth";

export function rutaPermitida(peticion: Request): boolean {
  const ruta = new URL(peticion.url).pathname;
  if (!ruta.startsWith(`${PREFIJO_AUTH}/`)) return false;
  return (RUTAS_DE_AUTH as readonly string[]).includes(`${peticion.method} ${ruta.slice(PREFIJO_AUTH.length)}`);
}
