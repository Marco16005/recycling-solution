import { randomBytes } from "node:crypto";

/** Contraseña aleatoria de 20 caracteres (letras y números) para entregar en persona. */
export function claveAleatoria(): string {
  return randomBytes(15).toString("base64url").replace(/[-_]/g, "x").slice(0, 20);
}
