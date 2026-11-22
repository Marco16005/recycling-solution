import { expect, test, type Locator, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { crearConexion } from "../src/datos/conexion-base";
import { planes } from "../src/datos/esquema";
import { fechaEnMexico } from "../src/dominio/tiempo";
import { prepararDiaOperador } from "./ayudas/operador";
import { entrarComo } from "./ayudas/sesion";

async function yaHayPlanDeHoy() {
  const { bd, cerrar } = crearConexion(process.env.DATABASE_URL ?? "", 1);
  try {
    const existentes = await bd.select({ id: planes.id }).from(planes)
      .where(and(eq(planes.fecha, fechaEnMexico(new Date())), eq(planes.estado, "validado"))).limit(1);
    return existentes.length > 0;
  } finally { await cerrar(); }
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
  test.skip(await yaHayPlanDeHoy(), "La prueba necesita la base e2e sin otro plan validado de hoy");
  // Este escenario prepara un plan validado de hoy; el de ayudas/plan es para el siguiente día operativo.
  const dia = await prepararDiaOperador();
  await entrarComo(page, "despachador");
  await page.goto(`/despacho/plan?fecha=${dia.fecha}`);
  const seguimiento = page.getByRole("region", { name: "Seguimiento de operación", exact: true });
  const camion = seguimiento.getByRole("article", { name: `Camión ${dia.placa}`, exact: true });
  await expect(camion.getByText("Sin llegar al patio", { exact: true })).toBeVisible();
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
    await marcar(camion, `Llegó a ${cliente}`);
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
