import { expect, test, type Locator, type Page } from "@playwright/test";
import { prepararDiaOperador } from "./ayudas/operador";
import { entrarComo } from "./ayudas/sesion";

/** A 412 px (teléfono), la tarjeta del camión no se sale de la pantalla aunque el cliente tenga un nombre muy largo. */
async function sinDesborde(camion: Locator) {
  await expect.poll(() => camion.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().right <= window.innerWidth + 1)).toBe(true);
}

async function marcar(camion: Locator, nombre: string) {
  await camion.getByRole("button", { name: `Marcar: ${nombre}`, exact: true }).click();
  const formulario = camion.getByRole("form", { name: /Marcar avance de / });
  await expect(formulario.getByLabel("Hora en Ciudad de México")).toBeVisible();
  await formulario.getByRole("button", { name: "Confirmar marca", exact: true }).click();
  await expect(formulario).toHaveCount(0);
}

test("despacho marca un viaje completo sin odómetro y gerencia solo lo consulta", async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  // El día de hoy lo comparte con la prueba del operador; el torton del tablero es solo de esta prueba (ayudas/operador).
  const dia = { ...(await prepararDiaOperador()) };
  dia.placa = dia.tableroPlaca;
  await entrarComo(page, "despachador");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/despacho/plan?fecha=${dia.fecha}`);
  const seguimiento = page.getByRole("region", { name: "Cómo va el día", exact: true });
  const camion = seguimiento.getByRole("article", { name: `Camión ${dia.placa}`, exact: true });
  await expect(camion.getByText("Sin llegar al patio", { exact: true })).toBeVisible();
  const primeraTarjeta = seguimiento.getByRole("article", { name: /^Camión / }).first();
  await expect.poll(async () => (await primeraTarjeta.boundingBox())?.y ?? 900).toBeLessThan(900);
  await page.setViewportSize({ width: 412, height: 915 });
  await sinDesborde(camion);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const viaje = camion.getByRole("list", { name: "Recolecciones del viaje 1", exact: true });
  const paradas = await viaje.getByRole("listitem").count();
  expect(paradas).toBeGreaterThan(0);

  await marcar(camion, "Llegó al patio");
  await expect(camion.getByText("En el patio, sin salir", { exact: true })).toBeVisible();
  await camion.getByRole("button", { name: "Marcar: Salió del patio (viaje 1)", exact: true }).click();
  const salida = camion.getByRole("form", { name: `Marcar avance de ${dia.placa}`, exact: true });
  await expect(salida.getByRole("spinbutton", { name: "Odómetro (km, opcional)" })).toHaveValue("");
  await salida.getByRole("button", { name: "Confirmar marca", exact: true }).click();
  await expect(camion.getByText(/^Viaje 1: en camino a /)).toBeVisible();

  for (let i = 0; i < paradas; i++) {
    const llegada = camion.getByRole("button", { name: /^Marcar: Llegó a / });
    const cliente = (await llegada.innerText()).replace(/^Marcar: Llegó a /, "");
    await sinDesborde(camion);
    await marcar(camion, `Llegó a ${cliente}`);
    await sinDesborde(camion);
    await expect(camion.getByText(`Viaje 1: en ${cliente}, esperando`, { exact: true })).toBeVisible();
    await marcar(camion, `Empezó a recolectar en ${cliente}`);
    await expect(camion.getByText(`Viaje 1: recolectando en ${cliente}`, { exact: true })).toBeVisible();
    await marcar(camion, `Terminó de recolectar en ${cliente}`);
    await expect(viaje.getByRole("listitem").nth(i).getByText("Recolectada", { exact: true })).toBeVisible();
    await expect(camion.getByText(new RegExp(`^${i + 1} de \\d+ recolecciones$`))).toBeVisible();
  }

  await expect(camion.getByText("Viaje 1: regresando al patio", { exact: true })).toBeVisible();
  await camion.getByRole("button", { name: "Marcar: Regresó al patio (viaje 1)", exact: true }).click();
  const regreso = camion.getByRole("form", { name: `Marcar avance de ${dia.placa}`, exact: true });
  await expect(regreso.getByRole("spinbutton", { name: "Odómetro (km, opcional)" })).toHaveValue("");
  await regreso.getByRole("button", { name: "Confirmar marca", exact: true }).click();
  await expect(camion.getByText("Viaje 1: descargando en el patio", { exact: true })).toBeVisible();
  await marcar(camion, "Terminó de descargar (viaje 1)");
  await expect(camion.getByText("Terminado", { exact: true }).first()).toBeVisible();

  const contexto = await browser.newContext({ baseURL, locale: "es-MX", timezoneId: "America/Mexico_City" });
  try {
    const gerencia: Page = await contexto.newPage();
    await entrarComo(gerencia, "gerencia");
    await gerencia.goto(`/despacho/plan?fecha=${dia.fecha}`);
    const lectura = gerencia.getByRole("article", { name: `Camión ${dia.placa}`, exact: true });
    await expect(lectura.getByText("Terminado", { exact: true }).first()).toBeVisible();
    await expect(lectura.getByRole("button", { name: /^Marcar:/ })).toHaveCount(0);
    await expect(lectura.getByRole("button", { name: "No se pudo atender", exact: true })).toHaveCount(0);
  } finally { await contexto.close(); }
});
