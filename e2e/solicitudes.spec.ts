import { expect, test, type Page } from "@playwright/test";
import { nombreUnico } from "./ayudas/datos";
import { entrarComo } from "./ayudas/sesion";

async function crearClienteSinAviso(page: Page) {
  const nombre = nombreUnico("Solicitud cliente E2E");
  await page.goto("/despacho/clientes/nuevo");
  const ficha = page.getByRole("form", { name: "Ficha del cliente", exact: true });
  await ficha.getByLabel("Nombre del cliente", { exact: true }).fill(nombre);
  await ficha.getByLabel("Latitud", { exact: true }).fill("20.61");
  await ficha.getByLabel("Longitud", { exact: true }).fill("-100.28");
  await ficha.getByLabel("Tipo de residuo", { exact: true }).selectOption("RME");
  await ficha.getByRole("checkbox", { name: "Doble rodada", exact: true }).check();
  // Todas las fechas de prueba quedan habilitadas, incluso si la corrida cruza la medianoche.
  for (let dia = 0; dia < 7; dia++) {
    await ficha.getByRole("button", { name: "Agregar ventana", exact: true }).click();
    await ficha.getByLabel(`Día · ventana ${dia + 1}`, { exact: true }).selectOption(String(dia));
  }
  await ficha.getByRole("button", { name: "Guardar cliente", exact: true }).click();
  await expect(page).toHaveURL(/\/despacho\/clientes\/[0-9a-f-]{36}$/i);
  await expect(page.getByRole("heading", { name: nombre, exact: true })).toBeVisible();
  return { nombre, url: page.url() };
}

function elemento(page: Page, folio: string) {
  return page.getByRole("region", { name: "Cola de solicitudes", exact: true }).getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: folio, exact: true }) });
}

async function registrar(page: Page, nombre: string) {
  await page.goto("/despacho/solicitudes");
  const alta = page.getByRole("form", { name: "Alta rápida de solicitud", exact: true });
  await alta.getByLabel("Buscar cliente por nombre", { exact: true }).fill(nombre);
  await alta.getByRole("button", { name: `Seleccionar ${nombre}`, exact: true }).click();
  await expect(alta).toContainText("Impedimentos de hoy");
  const fecha = await alta.getByLabel("Fecha solicitada", { exact: true }).inputValue();
  await alta.getByRole("button", { name: "Registrar solicitud", exact: true }).click();
  const mensaje = alta.getByRole("status").filter({ hasText: "Solicitud registrada · Folio" });
  await expect(mensaje).toBeVisible();
  const folio = (await mensaje.innerText()).match(/S-\d{8}-\d{3,}/)?.[0];
  expect(folio).toBeTruthy();
  await expect(alta.getByLabel("Buscar cliente por nombre", { exact: true })).toHaveValue("");
  // Consultar la fecha capturada evita depender del cambio de día durante el guardado.
  await page.goto(`/despacho/solicitudes?fecha=${fecha}`);
  await expect(elemento(page, folio!)).toBeVisible();
  return { folio: folio!, fecha };
}

test("solicitud bloqueada vuelve a lista al registrar el aviso sin cambiar folio ni hora", async ({ page }) => {
  test.setTimeout(90000);
  await entrarComo(page, "despachador");
  const cliente = await crearClienteSinAviso(page);
  const { folio, fecha } = await registrar(page, cliente.nombre);
  const fila = elemento(page, folio);
  await expect(fila.getByText("Bloqueada", { exact: true })).toBeVisible();
  await expect(fila).toContainText("Falta aviso vigente sin oposición del contacto");
  const instante = await fila.locator("time").getAttribute("datetime");
  expect(instante).toBeTruthy();
  const horaVisible = await fila.locator("time").innerText();

  await page.goto(cliente.url);
  const privacidad = page.getByRole("region", { name: "06 · Aviso de privacidad", exact: true });
  await privacidad.getByLabel("Movimiento", { exact: true }).selectOption("aceptado");
  await privacidad.getByLabel("Medio de registro", { exact: true }).selectOption("papel");
  await privacidad.getByRole("button", { name: "Registrar movimiento", exact: true }).click();
  await expect(privacidad.getByText("Aviso dado a conocer sin oposición", { exact: true })).toBeVisible();
  await page.goto(`/despacho/solicitudes?fecha=${fecha}`);
  await expect(fila.getByText("Lista para planear", { exact: true })).toBeVisible();
  await expect(fila.getByRole("heading", { name: folio, exact: true })).toBeVisible();
  await expect(fila.locator("time")).toHaveAttribute("datetime", instante!);
  await expect(fila.locator("time")).toHaveText(horaVisible);
  await expect(fila.getByText("Bloqueada", { exact: true })).toHaveCount(0);
});

test("reprogramar conserva el registro y cancelar exige y conserva un motivo", async ({ page }) => {
  test.setTimeout(90000);
  await entrarComo(page, "despachador");
  const cliente = await crearClienteSinAviso(page);
  const { folio, fecha } = await registrar(page, cliente.nombre);
  const fila = elemento(page, folio);
  const instante = await fila.locator("time").getAttribute("datetime");
  const siguiente = new Date(`${fecha}T00:00:00Z`);
  siguiente.setUTCDate(siguiente.getUTCDate() + 1);
  const manana = siguiente.toISOString().slice(0, 10);
  await fila.getByRole("button", { name: "Reprogramar", exact: true }).click();
  const reprogramar = fila.getByRole("form", { name: `Reprogramar ${folio}`, exact: true });
  await reprogramar.getByLabel("Nueva fecha solicitada", { exact: true }).fill(manana);
  await reprogramar.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(fila.getByText("Futura", { exact: true })).toBeVisible();
  await expect(fila.locator("time")).toHaveAttribute("datetime", instante!);
  await page.reload();
  await expect(fila.getByText("Futura", { exact: true })).toBeVisible();
  await expect(fila.getByText(manana, { exact: true })).toHaveCount(2);

  await fila.getByRole("button", { name: "Cancelar solicitud", exact: true }).click();
  const cancelar = fila.getByRole("form", { name: `Cancelar ${folio}`, exact: true });
  await cancelar.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(cancelar.getByRole("alert")).toContainText("Revisa los datos");
  await expect(cancelar.getByLabel("Motivo de cancelación", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(cancelar.getByLabel("Motivo de cancelación", { exact: true })).toBeFocused();
  const motivo = "Cliente sintético solicita cancelar la recolección";
  await cancelar.getByLabel("Motivo de cancelación", { exact: true }).fill(motivo);
  await cancelar.getByRole("button", { name: "Confirmar", exact: true }).click();
  // Las cerradas solo aparecen en la consulta de su fecha solicitada.
  await expect(fila).toHaveCount(0);
  await page.goto(`/despacho/solicitudes?fecha=${manana}`);
  await expect(fila.getByText("Cerrada · Cancelada", { exact: true })).toBeVisible();
  await expect(fila).toContainText(`Cancelación: ${motivo}`);
  await expect(fila.locator("time")).toHaveAttribute("datetime", instante!);
  await expect(fila.getByRole("button", { name: "Reprogramar", exact: true })).toHaveCount(0);
});

test("gerencia ve la cola sin alta, cancelación ni reprogramación", async ({ page, browser, baseURL }) => {
  test.setTimeout(90000);
  await entrarComo(page, "despachador");
  const cliente = await crearClienteSinAviso(page);
  const { folio, fecha } = await registrar(page, cliente.nombre);
  const contexto = await browser.newContext({ baseURL, locale: "es-MX", timezoneId: "America/Mexico_City" });
  try {
    const gerencia = await contexto.newPage();
    await entrarComo(gerencia, "gerencia");
    await gerencia.goto(`/despacho/solicitudes?fecha=${fecha}`);
    await expect(gerencia.getByRole("heading", { name: "Solicitudes", exact: true })).toBeVisible();
    const fila = elemento(gerencia, folio);
    await expect(fila).toContainText(cliente.nombre);
    await expect(fila.getByText("Bloqueada", { exact: true })).toBeVisible();
    await expect(gerencia.getByRole("form", { name: "Alta rápida de solicitud", exact: true })).toHaveCount(0);
    await expect(gerencia.getByRole("button", { name: "Registrar solicitud", exact: true })).toHaveCount(0);
    await expect(fila.getByRole("button", { name: "Cancelar solicitud", exact: true })).toHaveCount(0);
    await expect(fila.getByRole("button", { name: "Reprogramar", exact: true })).toHaveCount(0);
  } finally {
    await contexto.close();
  }
});
