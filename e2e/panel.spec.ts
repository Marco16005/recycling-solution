import { expect, test } from "@playwright/test";
import { sembrarDiaOperado } from "./ayudas/indicadores";
import { entrarComo } from "./ayudas/sesion";

// Plan 6, I4 (reasignado a Claude mientras Codex no tenía cuota; Codex lo revisó). Un día de ayer ya operado, con datos
// exclusivos (e2e/ayudas/indicadores.ts), y los valores calculados a mano en el panel y en el CSV.

test("gerencia ve en el panel y en el CSV los indicadores de un día operado; un operador no", async ({ page, browser, baseURL }) => {
  const { fecha, folios, placa } = await sembrarDiaOperado();
  await entrarComo(page, "gerencia");
  await page.goto(`/gerencia/panel?desde=${fecha}&hasta=${fecha}`);
  await expect(page.getByRole("heading", { name: "Panel de indicadores", exact: true })).toBeVisible();
  const tarjeta = (titulo: string) => page.getByRole("region", { name: titulo, exact: true });

  // Espera 10 min del viaje entre 2 completadas = 5; traslados 15 y 20 = 17.5; ciclos 75 y 80 = 77.5.
  await expect(tarjeta("K1 · Espera de asignación")).toContainText("5min");
  await expect(tarjeta("K1 · Espera de asignación")).toContainText("Muestra: 2 · Línea base: 15 min");
  await expect(tarjeta("K1 · Traslado")).toContainText("17.5min");
  await expect(tarjeta("Tiempo de ciclo")).toContainText("77.5min");
  await expect(tarjeta("K3 · Inicio dentro de la ventana")).toContainText("100%");
  // 30 km reales contra 20 de contrafactual (−50 %); simulado 20 contra 40 (50 %).
  await expect(tarjeta("K4 · Ahorro observado (odómetros)")).toContainText("-50%");
  await expect(tarjeta("K4 · Ahorro simulado (plan del motor)")).toContainText("50%");
  // Revisión de 07:32 a 07:36: 4 min contra la meta de 5.
  await expect(tarjeta("K6 · Trabajo activo, plan del día")).toContainText("4min");
  await expect(tarjeta("K6 · Trabajo activo, plan del día")).toContainText("Meta: 5 min");

  const respuesta = await page.request.get(`/api/indicadores/csv?desde=${fecha}&hasta=${fecha}`);
  expect(respuesta.status()).toBe(200);
  expect(respuesta.headers()["content-type"]).toContain("text/csv");
  const filas = (await respuesta.text()).replace(/^﻿/, "").trimEnd().split("\r\n");
  expect(filas[0]).toBe("fecha,folio,cliente,placa,viaje,estado,espera_min,traslado_min,servicio_min,regreso_y_descarga_min,ciclo_min,dentro_de_ventana,km_contrafactual");
  const fila = (folio: string) => filas.find((f) => f.startsWith(`${fecha},${folio},`)) ?? "";
  // Regreso y descarga: 10:45 − 09:45 = 60 min entre 2 completadas = 30.
  expect(fila(folios[0])).toMatch(new RegExp(`,${placa},1,completada,5,15,25,30,75,si,10$`));
  expect(fila(folios[1])).toMatch(new RegExp(`,${placa},1,completada,5,20,25,30,80,si,10$`));

  const otro = await browser.newContext({ baseURL });
  try {
    const operador = await otro.newPage();
    await entrarComo(operador, "operador");
    expect((await operador.request.get(`/api/indicadores/csv?desde=${fecha}&hasta=${fecha}`)).status()).toBe(403);
  } finally {
    await otro.close();
  }
});
