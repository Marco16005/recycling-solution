import { expect, test, type Page } from "@playwright/test";
import { nombreUnico } from "./ayudas/datos";
import { entrarComo } from "./ayudas/sesion";

function ficha(page: Page, entidad: "unidad" | "operador") {
  return page.getByRole("form", { name: `Ficha de ${entidad}`, exact: true });
}

function disponibilidad(page: Page) {
  return page.getByRole("region", { name: "Disponibilidad guardada", exact: true });
}

function fechaFutura() {
  const fecha = new Date();
  fecha.setUTCFullYear(fecha.getUTCFullYear() + 2);
  return fecha.toISOString().slice(0, 10);
}

async function completarDocumentos(page: Page, entidad: "unidad" | "operador", omitirPrimero = false) {
  const formulario = ficha(page, entidad);
  const estados = formulario.getByLabel("Estado", { exact: true });
  await expect(estados.first()).toBeVisible();
  const cantidad = await estados.count();
  for (let i = 0; i < cantidad; i++) {
    if (i === 0 && omitirPrimero) {
      await formulario.getByRole("switch").nth(i).check();
      await estados.nth(i).selectOption("pendiente");
    } else {
      await estados.nth(i).selectOption("vigente");
      await formulario.getByLabel("Fecha de vencimiento", { exact: true }).nth(i).fill(fechaFutura());
    }
  }
}

async function crearUnidad(page: Page, incompleta = false) {
  const placa = nombreUnico("E2E").replace(/[^a-z0-9]/gi, "").toUpperCase();
  await page.goto("/despacho/unidades/nueva");
  await ficha(page, "unidad").getByLabel("Placa", { exact: true }).fill(placa);
  await completarDocumentos(page, "unidad", incompleta);
  await ficha(page, "unidad").getByRole("button", { name: "Guardar unidad", exact: true }).click();
  await expect(page).toHaveURL(/\/despacho\/unidades\/[0-9a-f-]{36}$/i);
  await expect(page.getByRole("heading", { name: placa, exact: true })).toBeVisible();
  return { placa, url: page.url(), id: page.url().split("/").at(-1)! };
}

async function crearOperador(page: Page) {
  const nombre = nombreUnico("Operador sintético E2E");
  await page.goto("/despacho/operadores/nuevo");
  await ficha(page, "operador").getByLabel("Nombre del operador", { exact: true }).fill(nombre);
  await completarDocumentos(page, "operador");
  await ficha(page, "operador").getByRole("button", { name: "Guardar operador", exact: true }).click();
  await expect(page).toHaveURL(/\/despacho\/operadores\/[0-9a-f-]{36}$/i);
  await expect(page.getByRole("heading", { name: nombre, exact: true })).toBeVisible();
  return { nombre, url: page.url(), id: page.url().split("/").at(-1)! };
}

async function entregarAviso(page: Page) {
  await page.getByRole("button", { name: "Confirmar entrega del aviso vigente", exact: true }).click();
  await expect(page.getByText(/^Entregado: versión /)).toBeVisible();
  await expect(disponibilidad(page).getByText("Disponible", { exact: true })).toBeVisible();
}

test("unidad: documento obligatorio pendiente impide salir; completarlo la habilita", async ({ page }) => {
  await entrarComo(page, "despachador");
  const unidad = await crearUnidad(page, true);
  await expect(disponibilidad(page).getByText("No disponible", { exact: true })).toBeVisible();
  await expect(disponibilidad(page)).toContainText("Documento obligatorio no vigente");
  const documento = (await ficha(page, "unidad").locator("legend").first().innerText()).trim();
  await expect(disponibilidad(page)).toContainText(documento);

  await completarDocumentos(page, "unidad");
  await ficha(page, "unidad").getByRole("button", { name: "Guardar unidad", exact: true }).click();
  await expect(ficha(page, "unidad").getByRole("status")).toHaveText("Ficha guardada.");
  await expect(disponibilidad(page).getByText("Disponible", { exact: true })).toBeVisible();
  await page.reload();
  await expect(disponibilidad(page).getByText("Disponible", { exact: true })).toBeVisible();

  await page.goto(`/despacho/unidades?q=${encodeURIComponent(unidad.placa)}`);
  const fila = page.getByRole("region", { name: "Listado de unidades", exact: true })
    .getByRole("listitem").filter({ has: page.getByRole("link", { name: unidad.placa, exact: true }) });
  await expect(fila.getByText("Disponible", { exact: true })).toBeVisible();
});

test("operador: entrega del aviso habilita la jornada y la asignación retira la unidad de libres", async ({ page }) => {
  test.setTimeout(90000);
  await entrarComo(page, "despachador");
  const unidad = await crearUnidad(page);
  const operador = await crearOperador(page);
  await expect(disponibilidad(page).getByText("No disponible", { exact: true })).toBeVisible();
  await expect(disponibilidad(page)).toContainText("Aviso de privacidad no entregado");
  await entregarAviso(page);

  await page.goto("/despacho/jornada");
  const unidades = page.getByLabel("Unidad libre", { exact: true });
  const operadores = page.getByLabel("Operador libre", { exact: true });
  await unidades.selectOption(unidad.id);
  await operadores.selectOption(operador.id);
  await page.getByLabel("Disponible desde", { exact: true }).fill("09:15");
  await page.getByRole("button", { name: "Asignar jornada", exact: true }).click();
  const asignadas = page.locator("section").filter({
    has: page.getByRole("heading", { name: /^Jornadas asignadas/ }),
  });
  const fila = asignadas.getByRole("listitem").filter({
    has: page.getByRole("link", { name: unidad.placa, exact: true }),
  });
  await expect(fila).toContainText(operador.nombre);
  await expect(fila).toContainText("09:15");
  await expect(unidades.locator(`option[value="${unidad.id}"]`)).toHaveCount(0);
  await expect(operadores.locator(`option[value="${operador.id}"]`)).toHaveCount(0);
  await page.reload();
  await expect(fila).toContainText(operador.nombre);
  await expect(unidades.locator(`option[value="${unidad.id}"]`)).toHaveCount(0);
});

test("gerencia consulta flota y jornada sin controles de edición", async ({ page, browser, baseURL }) => {
  test.setTimeout(90000);
  await entrarComo(page, "despachador");
  const unidad = await crearUnidad(page);
  const operador = await crearOperador(page);
  const contexto = await browser.newContext({ baseURL, locale: "es-MX", timezoneId: "America/Mexico_City" });
  try {
    const gerencia = await contexto.newPage();
    await entrarComo(gerencia, "gerencia");
    await gerencia.goto("/despacho/unidades");
    await expect(gerencia.getByRole("heading", { name: "Unidades", exact: true })).toBeVisible();
    await expect(gerencia.getByRole("link", { name: "Nueva unidad", exact: true })).toHaveCount(0);
    await gerencia.goto(unidad.url);
    await expect(ficha(gerencia, "unidad").getByLabel("Placa", { exact: true })).toHaveValue(unidad.placa);
    await expect(ficha(gerencia, "unidad").getByLabel("Placa", { exact: true })).toBeDisabled();
    await expect(ficha(gerencia, "unidad").getByRole("switch").first()).toBeDisabled();
    await expect(gerencia.getByRole("button", { name: "Guardar unidad", exact: true })).toHaveCount(0);
    await gerencia.goto(operador.url);
    await expect(ficha(gerencia, "operador").getByLabel("Nombre del operador", { exact: true })).toBeDisabled();
    await expect(gerencia.getByRole("button", { name: "Guardar operador", exact: true })).toHaveCount(0);
    await expect(gerencia.getByRole("button", { name: "Confirmar entrega del aviso vigente" })).toHaveCount(0);
    await gerencia.goto("/despacho/jornada");
    await expect(gerencia.getByRole("heading", { name: "Jornada", exact: true })).toBeVisible();
    await expect(gerencia.getByText("Consulta de gerencia · Solo lectura", { exact: true })).toBeVisible();
    await expect(gerencia.getByLabel("Unidad libre", { exact: true })).toHaveCount(0);
    await expect(gerencia.getByRole("button", { name: "Asignar jornada", exact: true })).toHaveCount(0);
    await expect(gerencia.getByRole("button", { name: "Quitar", exact: true })).toHaveCount(0);
  } finally {
    await contexto.close();
  }
});
