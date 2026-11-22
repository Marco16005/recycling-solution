import { expect, test } from "@playwright/test";
import { sembrarJornadaAtrasada } from "./ayudas/calles";
import { entrarComo } from "./ayudas/sesion";

test("despachador ve el riesgo y la llegada proyectada de un viaje atrasado sin llegada", async ({ page }) => {
  const { fecha, folio, placa } = await sembrarJornadaAtrasada();
  await entrarComo(page, "despachador");
  await page.goto(`/despacho/plan?fecha=${fecha}`);

  // P7-7 debe proyectar con el reloj actual la jornada de hace dos días, sin nuevos eventos.
  const seguimiento = page.getByRole("region", { name: "Cómo va el día", exact: true });
  const alertas = seguimiento.getByRole("region", { name: "Alertas", exact: true });
  await expect(alertas).toBeVisible();
  await expect(alertas).toContainText("1 paradas en riesgo");
  const riesgo = alertas.getByRole("listitem").filter({ hasText: folio }).filter({ hasText: "En riesgo" });
  await expect(riesgo).toHaveCount(1);
  await expect(riesgo).toBeVisible();
  await expect(riesgo).toContainText(placa);
  await expect(riesgo).toContainText("viaje en curso");

  const jornada = seguimiento.getByRole("article").filter({
    has: page.getByRole("heading", { name: new RegExp(`^${placa} ·`) }),
  });
  const parada = jornada.getByRole("listitem").filter({ hasText: folio });
  // Tablero del día: la parada que ya salió muestra la hora prevista y, si cambió, la del plan.
  await expect(parada).toContainText("En camino");
  await expect(parada).toContainText(/Llegada prevista (?:[01]\d|2[0-3]):[0-5]\d\b/);
  await expect(parada).toContainText("(plan: 08:10)");
  await expect(parada).toContainText("Horario del cliente");
});
