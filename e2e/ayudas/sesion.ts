import { expect, type Page } from "@playwright/test";

/** Usuarios sintéticos que crea scripts/semilla-e2e.mts (Plan 1 v2, §3.5). Todos usan la contraseña E2E_CLAVE. */
export const USUARIOS_E2E = {
  admin: "admin@e2e.local",
  despachador: "despachador@e2e.local",
  despachador2: "despachador2@e2e.local",
  gerencia: "gerencia@e2e.local",
  operador: "operador@e2e.local",
  /** Despachador desactivado desde la semilla. */
  inactivo: "inactivo@e2e.local",
  /** Despachador activo que las pruebas de autenticación desactivan a media sesión. */
  baja: "baja@e2e.local",
} as const;

export type UsuarioE2E = keyof typeof USUARIOS_E2E;

export function claveE2E(): string {
  const clave = process.env.E2E_CLAVE;
  if (!clave) throw new Error("Falta E2E_CLAVE");
  return clave;
}

/** Llena y envía el formulario de entrada, sin esperar el resultado. */
export async function intentarEntrar(page: Page, usuario: UsuarioE2E, clave = claveE2E()): Promise<void> {
  await page.goto("/entrar");
  await page.getByLabel("Correo").fill(USUARIOS_E2E[usuario]);
  await page.getByLabel("Contraseña").fill(clave);
  await page.getByRole("button", { name: "Entrar" }).click();
}

/** Entra y espera a salir de /entrar. Para usuarios que sí pueden entrar. */
export async function entrarComo(page: Page, usuario: UsuarioE2E): Promise<void> {
  await intentarEntrar(page, usuario);
  await expect(page).not.toHaveURL(/\/entrar/);
}
