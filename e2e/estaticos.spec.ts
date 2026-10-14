import { expect, test } from "@playwright/test";

test("la imagen de producción sirve el worker del mapa", async ({ request }) => {
  const respuesta = await request.get("/maplibre-gl-worker.mjs");
  expect(respuesta.status()).toBe(200);
  expect(respuesta.headers()["content-type"]).toMatch(/javascript/);
});
