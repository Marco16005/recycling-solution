import { expect, test } from "@playwright/test";
import { nombreUnico } from "./ayudas/datos";
import { entrarComo } from "./ayudas/sesion";

/** Entra con un correo y contraseña cualesquiera (para usuarios creados en la prueba). */
async function entrarCon(page: import("@playwright/test").Page, correo: string, clave: string) {
  await page.goto("/entrar");
  await page.getByLabel("Correo").fill(correo);
  await page.getByLabel("Contraseña").fill(clave);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).not.toHaveURL(/\/entrar/);
}

/** Da de alta un despachador desde la pantalla de usuarios y devuelve su correo y su contraseña temporal. */
async function altaConTemporal(page: import("@playwright/test").Page, prefijo: string) {
  const correo = `${nombreUnico(prefijo).replace(/\s+/g, "-").toLowerCase()}@e2e.local`;
  // Acotado al formulario: Next conserva oculta la pantalla de entrada, que también tiene un campo "Correo".
  const alta = page.getByRole("form", { name: "Nuevo usuario" });
  await alta.getByLabel("Correo").fill(correo);
  await alta.getByLabel("Nombre").fill("Despachador de prueba");
  await expect(alta.getByRole("button", { name: "Crear usuario" })).toBeEnabled();
  await alta.getByRole("button", { name: "Crear usuario" }).click();
  const aviso = page.getByRole("status").filter({ hasText: correo });
  await expect(aviso).toBeVisible();
  const clave = (await aviso.locator("p.font-mono").innerText()).trim();
  expect(clave).toMatch(/^[A-Za-z0-9]{20}$/);
  await aviso.getByRole("button", { name: "Ya la entregué" }).click();
  return { correo, clave };
}

/** Llena "Mi contraseña" y la envía con el botón indicado. */
async function cambiarClave(pagina: import("@playwright/test").Page, actual: string, nueva: string, boton: string) {
  const formulario = pagina.getByRole("form", { name: "Cambiar mi contraseña" });
  await formulario.getByLabel("Contraseña actual").fill(actual);
  await formulario.getByLabel("Nueva contraseña").fill(nueva);
  await formulario.getByLabel("Confirma la nueva").fill(nueva);
  await formulario.getByRole("button", { name: boton }).click();
  return formulario;
}

test("el administrador crea un usuario con clave temporal; al cambiarle el rol se cierran sus sesiones", async ({ page, browser }) => {
  await entrarComo(page, "admin");
  await expect(page).toHaveURL(/\/admin\/usuarios$/);
  const { correo, clave } = await altaConTemporal(page, "desp");

  const otro = await browser.newContext();
  const suPagina = await otro.newPage();
  try {
    await entrarCon(suPagina, correo, clave);
    // Con la temporal solo puede cambiarla (diseño del 2026-11-07, §2.3); su sesión existe y el cambio de rol la cierra.
    await expect(suPagina).toHaveURL(/\/cuenta\/contrasena$/);

    const fila = page.getByRole("row").filter({ hasText: correo });
    await fila.getByLabel(/^Rol de/).selectOption("gerencia");
    await fila.getByRole("button", { name: /Guardar rol/ }).click();
    // El selector cambia en cuanto se elige; el botón desaparece solo cuando la tabla ya trae el rol guardado en el servidor.
    await expect(fila.getByRole("button", { name: /Guardar rol/ })).toHaveCount(0);
    await expect(page.getByRole("row").filter({ hasText: correo }).getByLabel(/^Rol de/)).toHaveValue("gerencia");

    await suPagina.reload();
    await expect(suPagina).toHaveURL(/\/entrar$/);
  } finally {
    await otro.close();
  }
});

test("con la contraseña temporal hay que cambiarla antes de seguir; después cada quien cambia la suya (2026-11-07)", async ({ page, browser }) => {
  await entrarComo(page, "admin");
  const { correo, clave } = await altaConTemporal(page, "temporal");
  const nueva = "mi-frase-nueva-de-prueba-1";
  const otraMas = "otra-frase-de-prueba-22";

  const otro = await browser.newContext();
  const suPagina = await otro.newPage();
  try {
    await entrarCon(suPagina, correo, clave);
    await expect(suPagina).toHaveURL(/\/cuenta\/contrasena$/);
    await expect(suPagina.getByRole("status").filter({ hasText: "contraseña temporal" })).toBeVisible();
    // Ninguna otra pantalla se abre antes del cambio.
    await suPagina.goto("/despacho/clientes");
    await expect(suPagina).toHaveURL(/\/cuenta\/contrasena$/);

    const formulario = await cambiarClave(suPagina, "no-es-la-temporal-1", nueva, "Guardar y continuar");
    await expect(formulario.getByText("La contraseña actual no es correcta")).toBeVisible();
    await cambiarClave(suPagina, clave, nueva, "Guardar y continuar");
    await expect(suPagina).toHaveURL(/\/despacho\/clientes$/);

    // Cambio voluntario desde el encabezado: la sesión sigue abierta.
    await suPagina.getByRole("link", { name: "Mi contraseña" }).click();
    await expect(suPagina).toHaveURL(/\/cuenta\/contrasena$/);
    await cambiarClave(suPagina, nueva, otraMas, "Cambiar contraseña");
    await expect(suPagina.getByRole("status").filter({ hasText: "Tu contraseña cambió" })).toBeVisible();
    await suPagina.getByRole("link", { name: "Volver" }).click();
    await expect(suPagina).toHaveURL(/\/despacho\/clientes$/);
  } finally {
    await otro.close();
  }

  // Ni la temporal ni la intermedia entran; la última sí.
  const tercero = await browser.newContext();
  const pagina3 = await tercero.newPage();
  try {
    for (const vieja of [clave, nueva]) {
      await pagina3.goto("/entrar");
      await pagina3.getByLabel("Correo").fill(correo);
      await pagina3.getByLabel("Contraseña").fill(vieja);
      await pagina3.getByRole("button", { name: "Entrar" }).click();
      await expect(pagina3.getByRole("alert").filter({ hasText: "No se pudo entrar" })).toBeVisible();
    }
    await entrarCon(pagina3, correo, otraMas);
    await expect(pagina3).toHaveURL(/\/despacho\/clientes$/);
  } finally {
    await tercero.close();
  }
});

test("el administrador no se restablece a sí mismo; con otro usuario pide confirmación (2026-11-07)", async ({ page }) => {
  await entrarComo(page, "admin");
  const propia = page.getByRole("row").filter({ hasText: "(tú)" });
  await expect(propia.getByRole("button", { name: "Restablecer contraseña" })).toHaveCount(0);
  await expect(propia.getByRole("link", { name: "Cambiar mi contraseña" })).toBeVisible();

  const { correo } = await altaConTemporal(page, "confirmar");
  const fila = page.getByRole("row").filter({ hasText: correo });
  await fila.getByRole("button", { name: "Restablecer contraseña" }).click();
  const confirmar = fila.getByRole("group", { name: /Confirmar restablecer/ });
  await expect(confirmar).toBeVisible();
  await confirmar.getByRole("button", { name: "Cancelar" }).click();
  await expect(confirmar).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: correo })).toHaveCount(0);

  await fila.getByRole("button", { name: "Restablecer contraseña" }).click();
  await fila.getByRole("button", { name: "Sí, restablecer" }).click();
  const aviso = page.getByRole("status").filter({ hasText: correo });
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText("le pedirá elegir una nueva");
  expect((await aviso.locator("p.font-mono").innerText()).trim()).toMatch(/^[A-Za-z0-9]{20}$/);
});

test("el administrador guarda la configuración de operación", async ({ page }) => {
  await entrarComo(page, "admin");
  await page.goto("/admin/configuracion");
  await expect(page.getByRole("button", { name: "Guardar configuración" })).toBeEnabled();
  await page.getByLabel("Velocidad promedio (km/h, respaldo sin mapa)").fill("32");
  // Plan 7: factor de camión y una franja de hora pico nueva.
  await page.getByLabel("Factor de camión (tiempos de auto del mapa × factor)").fill("1.25");
  await page.getByRole("button", { name: "Agregar franja" }).click();
  const nueva = page.getByRole("listitem", { name: "Franja 3" });
  await nueva.getByLabel("Inicio").fill("18:00");
  await nueva.getByLabel("Fin").fill("19:30");
  await nueva.getByLabel("Factor").fill("1.4");
  await page.getByRole("button", { name: "Guardar configuración" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Configuración guardada" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Velocidad promedio (km/h, respaldo sin mapa)")).toHaveValue("32");
  await expect(page.getByLabel("Factor de camión (tiempos de auto del mapa × factor)")).toHaveValue("1.25");
  await expect(page.getByRole("listitem", { name: "Franja 3" }).getByLabel("Inicio")).toHaveValue("18:00");
});

test("el administrador guarda la tolerancia para una parada extra (Plan 8)", async ({ page }) => {
  await entrarComo(page, "admin");
  await page.goto("/admin/configuracion");
  const guardar = page.getByRole("button", { name: "Guardar configuración" });
  await expect(guardar).toBeEnabled();
  const tolerancia = page.getByRole("spinbutton", { name: "Tolerancia para una parada extra (min de tiempo muerto)", exact: true });
  await expect(tolerancia).toHaveValue("15");
  await expect(tolerancia).toHaveAccessibleDescription("Si una parada extra alarga el día más que esto, se queda para otro día.");
  await tolerancia.fill("61");
  await guardar.click();
  await expect(page.getByRole("form", { name: "Configuración de operación", exact: true }).getByRole("alert")).toContainText("De 0 a 60 minutos");
  await tolerancia.fill("20");
  await guardar.click();
  await expect(page.getByRole("status").filter({ hasText: "Configuración guardada" })).toBeVisible();
  await page.reload();
  await expect(guardar).toBeEnabled();
  await expect(tolerancia).toHaveValue("20");
  // Las pruebas que siguen comparten la base: se deja el valor por omisión.
  await tolerancia.fill("15");
  await guardar.click();
  await expect(page.getByRole("status").filter({ hasText: "Configuración guardada" })).toBeVisible();
});

test("un despachador no entra a administración", async ({ page }) => {
  await entrarComo(page, "despachador");
  await page.goto("/admin/usuarios");
  await expect(page).toHaveURL(/\/sin-acceso$/);
});

test("el aviso de privacidad se consulta sin sesión y la entrada enlaza a él", async ({ page }) => {
  await page.goto("/entrar");
  await page.getByRole("link", { name: "Aviso de privacidad" }).click();
  await expect(page).toHaveURL(/\/aviso-de-privacidad$/);
  await expect(page.getByText(/aún no se ha publicado|Aviso de privacidad integral/)).toBeVisible();
});
