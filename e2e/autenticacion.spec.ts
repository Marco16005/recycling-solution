import { expect, test } from "@playwright/test";
import { desactivar } from "./ayudas/base";
import { claveE2E, entrarComo, intentarEntrar } from "./ayudas/sesion";

test("sin sesión, despacho lleva a la pantalla de entrada", async ({ page }) => {
  await page.goto("/despacho/clientes");
  await expect(page).toHaveURL(/\/entrar$/);
});

test("el despachador entra, llega a clientes y sale", async ({ page }) => {
  await entrarComo(page, "despachador");
  await expect(page).toHaveURL(/\/despacho\/clientes$/);
  await page.getByRole("button", { name: "Salir" }).click();
  await expect(page).toHaveURL(/\/entrar$/);
  await page.goto("/despacho/clientes");
  await expect(page).toHaveURL(/\/entrar$/);
});

test("contraseña equivocada: mensaje genérico y se queda en entrar", async ({ page }) => {
  await intentarEntrar(page, "despachador", "contraseña-equivocada");
  await expect(page.getByRole("alert").filter({ hasText: "No se pudo entrar" })).toBeVisible();
  await expect(page).toHaveURL(/\/entrar$/);
});

test("el registro público está cerrado", async ({ request, baseURL }) => {
  const respuesta = await request.post("/api/auth/sign-up/email", {
    headers: { origin: baseURL! },
    data: { email: "intruso@e2e.local", password: claveE2E(), name: "Intruso" },
  });
  expect(respuesta.status()).toBe(400);
});

test("el operador entra a su ruta y no tiene acceso a despacho", async ({ page }) => {
  await intentarEntrar(page, "operador");
  await expect(page).toHaveURL(/\/operador$/);
  await page.goto("/despacho/clientes");
  await expect(page).toHaveURL(/\/sin-acceso$/);
});

test("un usuario desactivado no puede entrar", async ({ page }) => {
  await intentarEntrar(page, "inactivo");
  await expect(page.getByRole("alert").filter({ hasText: "No se pudo entrar" })).toBeVisible();
  await expect(page).toHaveURL(/\/entrar$/);
});

test("al desactivar a un usuario con sesión abierta, la siguiente petición lo saca", async ({ page }) => {
  await entrarComo(page, "baja");
  await expect(page.getByRole("heading", { name: "Clientes" })).toBeVisible();
  await desactivar("baja");
  await page.reload();
  await expect(page).toHaveURL(/\/entrar$/);
});

test("salir sin señal deja la pantalla sin datos y cierra la sesión en el servidor al volver la red", async ({ page, context }) => {
  // Plan de seguridad, hallazgo 4.
  await entrarComo(page, "despachador");
  await expect(page.getByRole("heading", { name: "Clientes" })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Salir" }).click();
  await expect(page.getByRole("heading", { name: "Clientes" })).toHaveCount(0);
  await context.setOffline(false);
  // Al cargar /entrar con red, se completa el cierre pendiente; mientras tanto, «Entrar» espera.
  await page.goto("/entrar");
  await expect(page.getByRole("button", { name: "Entrar" })).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.goto("/despacho/clientes");
  await expect(page).toHaveURL(/\/entrar$/);
});
