import { expect, test } from "@playwright/test";
import { entrarComo } from "./ayudas/sesion";

// Plan 6, I4 (reasignado a Claude mientras Codex no tiene cuota; Codex lo revisa). El cálculo de cada indicador lo prueban
// src/indicadores (valores a mano) y src/consultas/indicadores.nucleo.test.ts (extracción); aquí, que el panel y el CSV
// lleguen a gerencia y no a quien no debe.

test("gerencia ve el panel de indicadores y descarga el CSV; un operador no entra", async ({ page, browser, baseURL }) => {
  await entrarComo(page, "gerencia");
  await page.goto("/gerencia/panel");
  await expect(page.getByRole("heading", { name: "Panel de indicadores", exact: true })).toBeVisible();
  for (const titulo of ["K1 · Espera de asignación", "K1 · Traslado", "Tiempo de ciclo", "K3 · Inicio dentro de la ventana", "K5 · Fichas completas (cartera activa)", "K7 · Tiempo del motor (mediana)"]) {
    await expect(page.getByRole("region", { name: titulo, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "K1 · Espera de asignación", exact: true })).toContainText("Línea base: 15 min");

  const respuesta = await page.request.get("/api/indicadores/csv");
  expect(respuesta.status()).toBe(200);
  expect(respuesta.headers()["content-type"]).toContain("text/csv");
  const texto = await respuesta.text();
  expect(texto.replace(/^﻿/, "").startsWith("fecha,folio,cliente,placa,viaje,estado,")).toBe(true);

  const otro = await browser.newContext({ baseURL });
  try {
    const operador = await otro.newPage();
    await entrarComo(operador, "operador");
    expect((await operador.request.get("/api/indicadores/csv")).status()).toBe(403);
  } finally {
    await otro.close();
  }
});
