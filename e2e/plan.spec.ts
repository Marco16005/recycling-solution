import { expect, test } from "@playwright/test";
import { estadoDeSolicitud, prepararEscenarioPlan } from "./ayudas/plan";
import { entrarComo } from "./ayudas/sesion";

test("despachador genera, ajusta y valida el plan; gerencia lo consulta en solo lectura", async ({ page, browser, baseURL }) => {
  test.setTimeout(90000);
  const { fecha, folios, placa, operador, clienteConInduccion } = await prepararEscenarioPlan();
  const ruta = `/despacho/plan?fecha=${fecha}`;
  await entrarComo(page, "despachador");
  await page.goto(ruta);
  const plan = page.getByRole("region", { name: "Plan del día", exact: true });
  // Una propuesta previa de otra prueba también debe incorporar estas solicitudes nuevas.
  await plan.getByRole("button", { name: /^(Generar plan|Regenerar)$/ }).click();
  const unidad = plan.getByRole("region", { name: `Unidad ${placa}`, exact: true });
  for (const folio of folios) {
    await expect(unidad.getByRole("article", { name: `Parada ${folio}`, exact: true })).toBeVisible();
  }

  await expect(plan.getByText(/^Tiempos por calle/)).toBeVisible();

  const segundoFolio = folios[1];
  const parada = unidad.getByRole("article", { name: `Parada ${segundoFolio}`, exact: true });
  await parada.getByRole("button", { name: "Posponer", exact: true }).click();
  const pospuestas = plan.getByRole("region", { name: "Solicitudes pospuestas", exact: true });
  const pospuesta = pospuestas.getByRole("article", { name: `Pospuesta ${segundoFolio}`, exact: true });
  await expect(pospuesta).toBeVisible();
  await expect(parada).toHaveCount(0);
  const mover = pospuesta.getByRole("form", { name: `Mover ${segundoFolio}`, exact: true });
  await mover.getByRole("combobox", { name: "Unidad", exact: true }).selectOption({ label: `${placa} · ${operador}` });
  await mover.getByRole("combobox", { name: "Viaje", exact: true }).selectOption("1");
  await mover.getByRole("combobox", { name: "Posición", exact: true }).selectOption("1");
  await mover.getByRole("button", { name: "Mover", exact: true }).click();
  await expect(pospuesta).toHaveCount(0);
  const viaje = unidad.getByRole("region", { name: "Viaje 1", exact: true });
  await expect(viaje.getByRole("article").first()).toHaveAttribute("aria-label", `Parada ${segundoFolio}`);
  for (const folio of folios) {
    await expect(unidad.getByRole("article", { name: `Parada ${folio}`, exact: true })).toBeVisible();
  }

  const requisitos = plan.getByRole("region", { name: "Requisitos de acceso", exact: true });
  await expect(requisitos).toContainText(clienteConInduccion);
  const validar = plan.getByRole("button", { name: "Validar", exact: true });
  await expect(validar).toBeDisabled();
  await requisitos.getByRole("checkbox", { name: `Confirmo los requisitos de ${operador}`, exact: true }).check();
  // El plan puede incluir otros operadores con requisitos procedentes de escenarios anteriores.
  for (const casilla of await requisitos.getByRole("checkbox").all()) {
    await casilla.check();
  }
  await validar.click();
  await expect(plan.getByText("Validado", { exact: true })).toBeVisible();
  for (const folio of folios) {
    expect(await estadoDeSolicitud(folio)).toMatchObject({ estado: "programada" });
  }

  await page.goto(`/despacho/solicitudes?fecha=${fecha}`);
  const cola = page.getByRole("region", { name: "Cola de solicitudes", exact: true });
  for (const folio of folios) {
    const fila = cola.getByRole("listitem").filter({ has: page.getByRole("heading", { name: folio, exact: true }) });
    await expect(fila.getByText("Programada", { exact: true })).toBeVisible();
  }

  const contexto = await browser.newContext({ baseURL, locale: "es-MX", timezoneId: "America/Mexico_City" });
  try {
    const gerencia = await contexto.newPage();
    await entrarComo(gerencia, "gerencia");
    await gerencia.goto(ruta);
    const lectura = gerencia.getByRole("region", { name: "Plan del día", exact: true });
    await expect(lectura.getByText("Solo lectura", { exact: true })).toBeVisible();
    await expect(lectura.getByText("Validado", { exact: true })).toBeVisible();
    const unidadLeida = lectura.getByRole("region", { name: `Unidad ${placa}`, exact: true });
    for (const folio of folios) {
      await expect(unidadLeida.getByRole("article", { name: `Parada ${folio}`, exact: true })).toBeVisible();
    }
    for (const nombre of ["Generar plan", "Regenerar", "Validar", "Posponer"]) {
      await expect(lectura.getByRole("button", { name: nombre, exact: true })).toHaveCount(0);
    }
  } finally {
    await contexto.close();
  }
});
