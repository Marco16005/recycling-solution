import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { CAMPOS_AVISO, llenarPlantilla, publicarAviso } from "../src/datos/avisos";

// Corre al final (orden alfabético, un solo worker): publicar cambia la versión vigente del aviso para todo lo que siga.
test("publicar el aviso lo deja vigente y visible sin sesión", async ({ page }) => {
  const valores = Object.fromEntries(CAMPOS_AVISO.map((c) => [c, `Dato sintético ${c}`]));
  valores.RAZON_SOCIAL = "Recicladora Sintética S.A. de C.V.";
  const plantilla = readFileSync("docs/legal/aviso-de-privacidad-integral.md", "utf8");
  const texto = llenarPlantilla(plantilla, "2026-12-31", "2026-12-31", valores);
  await publicarAviso(process.env.MIGRADOR_DATABASE_URL ?? "", { version: "2026-12-31", texto, motivo: "Prueba de punta a punta", publicadoPor: "e2e" });

  await page.goto("/aviso-de-privacidad");
  await expect(page.getByText("Versión 2026-12-31, publicada")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Aviso de privacidad integral" })).toBeVisible();
  await expect(page.getByText("Recicladora Sintética S.A. de C.V.").first()).toBeVisible();
  await expect(page.getByText("{{")).toHaveCount(0);
});
