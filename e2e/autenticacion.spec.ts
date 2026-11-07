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
  // Solo pasan las rutas de Better Auth que usa la aplicación (diseño del 2026-11-07, §2.4).
  expect(respuesta.status()).toBe(404);
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
  // El aviso solo aparece si el cierre sigue pendiente (Next tiene además su propio anunciador de rutas con role=alert).
  await expect(page.getByText("La sesión anterior no se pudo cerrar")).toHaveCount(0);
  await page.goto("/despacho/clientes");
  await expect(page).toHaveURL(/\/entrar$/);
});

test("una redirección a media respuesta no reemplaza la pantalla que el operador guardó para usar sin señal (2026-11-07)", async ({ page, context }) => {
  await entrarComo(page, "operador");
  await expect(page).toHaveURL(/\/operador$/);
  await expect.poll(() => page.evaluate(async () => {
    const registro = await navigator.serviceWorker.getRegistration("/operador");
    if (!registro?.active) return false;
    const nombres = (await caches.keys()).filter((n) => n.startsWith("rs-operador-"));
    return nombres.length === 1 && Boolean(await (await caches.open(nombres[0])).match("/operador"));
  }), { timeout: 30_000 }).toBe(true);

  // Como tras un restablecimiento: la cookie sigue en el teléfono pero su sesión ya no existe. Pasa el proxy y el layout
  // redirige a /entrar dentro de <Suspense>, con estado 200 y la redirección en el HTML.
  const sesion = (await context.cookies()).find((c) => c.name.includes("session_token"));
  expect(sesion).toBeDefined();
  await context.addCookies([{ ...sesion!, value: "sesion-que-ya-no-existe" }]);
  await page.goto("/operador");
  await expect(page).toHaveURL(/\/entrar$/);

  await context.setOffline(true);
  try {
    await page.goto("/operador");
    await expect(page).toHaveURL(/\/operador$/);
    await expect(page.getByText("E2E operador").first()).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
