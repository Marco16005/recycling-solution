import { expect, test, type Page } from "@playwright/test";
import { entrarComo } from "./ayudas/sesion";

// Plan de seguridad (S5): encabezados en la imagen de producción y ninguna violación de la política de contenido en
// las pantallas con mapa ni en la del operador (service worker).

/** Registra las violaciones de la política de contenido desde antes de que cargue cada documento. */
async function vigilarPolitica(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __violaciones: string[] };
    w.__violaciones = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      w.__violaciones.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return () => page.evaluate(() => (window as unknown as { __violaciones: string[] }).__violaciones);
}

test("la imagen de producción manda los encabezados de seguridad y no revela su tecnología", async ({ request }) => {
  const respuesta = await request.get("/entrar");
  expect(respuesta.status()).toBe(200);
  const h = respuesta.headers();
  expect(h["x-powered-by"]).toBeUndefined();
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("same-origin");
  expect(h["permissions-policy"]).toContain("geolocation=()");
  const politica = h["content-security-policy"] ?? "";
  expect(politica).toContain("frame-ancestors 'none'");
  expect(politica).toContain("object-src 'none'");
  expect(politica).toContain("connect-src 'self' https://tiles.openfreemap.org");
  expect(politica).not.toContain("'unsafe-eval'");
  // Las pruebas corren con http://web:3000: sin https no hay HSTS.
  expect(h["strict-transport-security"]).toBeUndefined();
});

test("los recursos estáticos también llevan los encabezados fijos", async ({ request }) => {
  const respuesta = await request.get("/maplibre-gl-worker.mjs");
  expect(respuesta.headers()["x-content-type-options"]).toBe("nosniff");
});

test("el mapa de la cartera y el plan del día cargan sin violar la política de contenido", async ({ page }) => {
  const violaciones = await vigilarPolitica(page);
  await entrarComo(page, "despachador");
  await page.goto("/despacho/clientes/mapa");
  await expect(page.locator(".maplibregl-canvas").first()).toBeVisible();
  // Da tiempo a que lleguen estilo, teselas, fuentes y el worker.
  await page.waitForLoadState("networkidle");
  expect(await violaciones()).toEqual([]);
  await page.goto("/despacho/plan");
  await page.waitForLoadState("networkidle");
  expect(await violaciones()).toEqual([]);
  // Control: una petición a un dominio no permitido sí queda bloqueada y registrada.
  await page.evaluate(() => fetch("https://ejemplo.invalid/").catch(() => undefined));
  await expect.poll(violaciones).toContainEqual(expect.stringMatching(/^connect-src https:\/\/ejemplo\.invalid/));
});

test("la pantalla del operador registra su service worker sin violar la política de contenido", async ({ page }) => {
  const violaciones = await vigilarPolitica(page);
  await entrarComo(page, "operador");
  await page.goto("/operador");
  await page.waitForLoadState("networkidle");
  expect(await violaciones()).toEqual([]);
});
