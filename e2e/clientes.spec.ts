import { expect, test, type Page, type Route } from "@playwright/test";
import { nombreUnico } from "./ayudas/datos";
import { entrarComo } from "./ayudas/sesion";

const RUTA_CLIENTES = "/despacho/clientes";
const RUTA_FICHA = /\/despacho\/clientes\/[0-9a-f-]{36}$/i;

function formularioCliente(page: Page) {
  return page.getByRole("form", { name: "Ficha del cliente", exact: true });
}

function filaCliente(page: Page, nombre: string) {
  return page
    .getByRole("region", { name: "Listado de clientes", exact: true })
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: nombre, exact: true }) });
}

async function abrirAlta(page: Page, nombre: string) {
  await page.goto(`${RUTA_CLIENTES}/nuevo`, { waitUntil: "domcontentloaded" });
  await formularioCliente(page).getByLabel("Nombre del cliente", { exact: true }).fill(nombre);
}

async function guardarAlta(page: Page, nombre: string) {
  await formularioCliente(page).getByRole("button", { name: "Guardar cliente", exact: true }).click();
  await expect(page).toHaveURL(RUTA_FICHA);
  await expect(page.getByRole("heading", { name: nombre, exact: true })).toBeVisible();
  await expect(formularioCliente(page).getByLabel("Nombre del cliente", { exact: true })).toHaveValue(nombre);
  return page.url();
}

async function crearCliente(page: Page, nombre: string) {
  await abrirAlta(page, nombre);
  return guardarAlta(page, nombre);
}

async function crearClienteCompleto(page: Page, nombre: string) {
  await abrirAlta(page, nombre);
  const ficha = formularioCliente(page);
  await ficha.getByLabel("Teléfono", { exact: true }).fill("442 555 0101");
  await ficha.getByLabel("Latitud", { exact: true }).fill("20.61");
  await ficha.getByLabel("Longitud", { exact: true }).fill("-100.28");
  await ficha.getByLabel("Tipo de residuo", { exact: true }).selectOption("RME");
  await ficha.getByRole("checkbox", { name: "Doble rodada", exact: true }).check();
  await ficha.getByRole("button", { name: "Agregar ventana", exact: true }).click();

  const dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const hoy = new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    weekday: "long",
  }).format(new Date());
  const diaSemana = dias.indexOf(hoy);
  expect(diaSemana).toBeGreaterThanOrEqual(0);
  await ficha.getByLabel("Día · ventana 1", { exact: true }).selectOption(String(diaSemana));
  await ficha.getByLabel("Hora de inicio", { exact: true }).fill("08:00");
  await ficha.getByLabel("Hora de fin", { exact: true }).fill("16:00");
  await ficha.getByRole("button", { name: "Agregar documento", exact: true }).click();
  await ficha.getByLabel("Nombre · documento 1", { exact: true }).fill("Permiso sintético E2E");
  await ficha.getByLabel("Estado registrado", { exact: true }).selectOption("vigente");
  const url = await guardarAlta(page, nombre);

  const privacidad = page.getByRole("region", { name: "06 · Aviso de privacidad", exact: true });
  await privacidad.getByLabel("Movimiento", { exact: true }).selectOption("aceptado");
  await privacidad.getByLabel("Medio de registro", { exact: true }).selectOption("papel");
  await privacidad.getByRole("button", { name: "Registrar movimiento", exact: true }).click();
  await expect(privacidad.getByText("Aviso dado a conocer sin oposición", { exact: true })).toBeVisible();
  return url;
}

async function buscar(page: Page, nombre: string) {
  await page.getByRole("textbox", { name: "Buscar clientes", exact: true }).fill(nombre);
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page).toHaveURL(
    (url) => url.pathname === RUTA_CLIENTES && url.searchParams.get("q") === nombre,
  );
}

async function analizarCsv(page: Page, contenido: string) {
  await page.getByLabel("Archivo CSV", { exact: true }).setInputFiles({
    name: "clientes-sinteticos.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(contenido, "utf8"),
  });
  await page.getByRole("button", { name: "Analizar archivo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "2 · Revisar y confirmar", exact: true })).toBeVisible();
}

async function irALista(page: Page) {
  await page.goto(RUTA_CLIENTES, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Clientes", exact: true })).toBeVisible();
}

test("alta completa con aviso de privacidad: ficha completa y habilitada hoy", async ({ page }) => {
  await entrarComo(page, "despachador");
  const nombre = nombreUnico("Alta completa E2E");
  await crearClienteCompleto(page, nombre);
  await irALista(page);
  const fila = filaCliente(page, nombre);
  await expect(fila).toHaveCount(1);
  await expect(fila.getByText("Completa", { exact: true })).toBeVisible();
  await expect(fila.getByText("Habilitada hoy", { exact: true })).toBeVisible();
});

test("edición: el campo guardado persiste al volver a abrir la ficha", async ({ page }) => {
  await entrarComo(page, "despachador");
  const nombre = nombreUnico("Edición E2E");
  const url = await crearCliente(page, nombre);
  const direccion = "Calle de Prueba 200, Parque Sintético";
  await formularioCliente(page).getByLabel("Dirección", { exact: true }).fill(direccion);
  await formularioCliente(page).getByRole("button", { name: "Guardar cliente", exact: true }).click();
  await expect(formularioCliente(page).getByRole("status")).toHaveText("Cliente guardado.");
  await irALista(page);
  await expect(filaCliente(page, nombre)).toContainText(direccion);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(formularioCliente(page).getByLabel("Dirección", { exact: true })).toHaveValue(direccion);
});

test("conflicto entre despachadores: conserva la captura y permite recuperar el borrador", async ({
  page,
  browser,
  baseURL,
}) => {
  await entrarComo(page, "despachador");
  const nombre = nombreUnico("Conflicto E2E");
  const url = await crearCliente(page, nombre);
  const otroContexto = await browser.newContext({
    baseURL,
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
  });
  try {
    const otraPagina = await otroContexto.newPage();
    await entrarComo(otraPagina, "despachador2");
    await otraPagina.goto(url, { waitUntil: "domcontentloaded" });
    const otraFicha = formularioCliente(otraPagina);
    const borrador = "Captura del segundo despachador";
    await otraFicha.getByLabel("Material", { exact: true }).fill(borrador);

    const guardado = "Cartón del primer despachador";
    await formularioCliente(page).getByLabel("Material", { exact: true }).fill(guardado);
    await formularioCliente(page).getByRole("button", { name: "Guardar cliente", exact: true }).click();
    await expect(formularioCliente(page).getByRole("status")).toHaveText("Cliente guardado.");
    await otraFicha.getByRole("button", { name: "Guardar cliente", exact: true }).click();
    await expect(otraFicha.getByRole("alert")).toContainText("Otro despachador modificó esta ficha");
    await expect(otraFicha.getByLabel("Material", { exact: true })).toHaveValue(borrador);
    await expect(otraFicha.getByRole("button", { name: "Guardar cliente", exact: true })).toBeDisabled();

    await otraFicha
      .getByRole("button", { name: "Recargar ficha sin perder mi captura", exact: true })
      .click();
    const cargar = otraFicha.getByRole("button", {
      name: "Cargar ficha actual y conservar borrador",
      exact: true,
    });
    await expect(cargar).toBeVisible();
    await expect(otraFicha.getByLabel("Material", { exact: true })).toHaveValue(borrador);
    await cargar.click();
    await expect(otraFicha.getByLabel("Material", { exact: true })).toHaveValue(guardado);
    await otraFicha.getByRole("button", { name: "Recuperar mi borrador", exact: true }).click();
    await expect(otraFicha.getByLabel("Material", { exact: true })).toHaveValue(borrador);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(formularioCliente(page).getByLabel("Material", { exact: true })).toHaveValue(guardado);
  } finally {
    await otroContexto.close();
  }
});

test("importación: una fila inválida impide confirmar; corregida, importa el lote completo", async ({
  page,
}) => {
  await entrarComo(page, "despachador");
  const primero = nombreUnico("CSV primero E2E");
  const segundo = nombreUnico("CSV segundo E2E");
  await page.getByRole("link", { name: "Importar CSV", exact: true }).click();
  await analizarCsv(page, `nombre,telefono,residuo\n${primero},4425550101,RME\n${segundo},123,RME\n`);
  const resumen = page.getByRole("region", { name: "2 · Revisar y confirmar", exact: true });
  await expect(resumen.getByRole("alert")).toContainText("Fila 3:");
  await expect(resumen.getByRole("alert")).toContainText("Teléfono no válido");
  await expect(page.getByRole("button", { name: "Confirmar importación", exact: true })).toBeDisabled();

  // El análisis no escribe ni siquiera la fila válida.
  const consulta = await page.context().newPage();
  try {
    await irALista(consulta);
    await expect(filaCliente(consulta, primero)).toHaveCount(0);
    await expect(filaCliente(consulta, segundo)).toHaveCount(0);
  } finally {
    await consulta.close();
  }

  await analizarCsv(page, `nombre,telefono,residuo\n${primero},4425550101,RME\n${segundo},4425550102,RME\n`);
  await expect(resumen.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Confirmar importación", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Confirmar importación", exact: true }).click();
  await expect(page.getByRole("heading", { name: "2 clientes importados", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Ver clientes", exact: true }).click();
  await expect(filaCliente(page, primero)).toHaveCount(1);
  await expect(filaCliente(page, segundo)).toHaveCount(1);
});

test("reintentar una confirmación cuya respuesta se perdió no duplica clientes", async ({ page }) => {
  await entrarComo(page, "despachador");
  const nombre = nombreUnico("Reintento CSV E2E");
  await page.getByRole("link", { name: "Importar CSV", exact: true }).click();
  await analizarCsv(page, `nombre,residuo\n${nombre},RME\n`);

  let interceptada = false;
  let estadoRespuesta: number | undefined;
  const perderRespuesta = async (ruta: Route) => {
    const peticion = ruta.request();
    if (interceptada || peticion.method() !== "POST" || !peticion.headers()["next-action"]) {
      await ruta.continue();
      return;
    }
    interceptada = true;
    // Ejecuta la acción real y consume su respuesta antes de simular la pérdida de conexión.
    const respuesta = await ruta.fetch({ maxRetries: 0 });
    estadoRespuesta = respuesta.status();
    await respuesta.body();
    await ruta.abort("failed");
  };
  const rutaImportacion = "**/despacho/clientes/importar";
  await page.route(rutaImportacion, perderRespuesta);
  try {
    await page.getByRole("button", { name: "Confirmar importación", exact: true }).click();
    const reintentar = page.getByRole("button", { name: "Reintentar confirmación", exact: true });
    await expect(reintentar).toBeEnabled();
    expect(interceptada).toBe(true);
    expect(estadoRespuesta).toBe(200);
    await expect(
      page
        .getByRole("form", { name: "Importar clientes desde CSV", exact: true })
        .getByRole("alert")
        .filter({ hasText: "No recibimos confirmación" }),
    ).toBeVisible();

    // Demuestra que el primer intento sí escribió antes de volver a confirmar desde la pantalla.
    const consulta = await page.context().newPage();
    try {
      await irALista(consulta);
      await buscar(consulta, nombre);
      await expect(filaCliente(consulta, nombre)).toHaveCount(1);
    } finally {
      await consulta.close();
    }

    await reintentar.click();
    await expect(page.getByRole("heading", { name: "1 clientes importados", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Ver clientes", exact: true }).click();
    await buscar(page, nombre);
    await expect(filaCliente(page, nombre)).toHaveCount(1);
  } finally {
    await page.unroute(rutaImportacion, perderRespuesta);
  }
});

test("gerencia consulta lista y ficha sin controles para escribir", async ({ page, browser, baseURL }) => {
  await entrarComo(page, "despachador");
  const nombre = nombreUnico("Consulta gerencia E2E");
  await crearCliente(page, nombre);
  const contextoGerencia = await browser.newContext({
    baseURL,
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
  });
  try {
    const gerencia = await contextoGerencia.newPage();
    await entrarComo(gerencia, "gerencia");
    await gerencia.goto("/despacho/clientes");
    await expect(gerencia.getByRole("heading", { name: "Clientes", exact: true })).toBeVisible();
    await expect(gerencia.getByRole("link", { name: "Nuevo cliente", exact: true })).toHaveCount(0);
    await expect(gerencia.getByRole("link", { name: "Importar CSV", exact: true })).toHaveCount(0);
    await filaCliente(gerencia, nombre).getByRole("link", { name: nombre, exact: true }).click();
    const ficha = formularioCliente(gerencia);
    await expect(ficha.getByLabel("Nombre del cliente", { exact: true })).toHaveValue(nombre);
    await expect(ficha.getByLabel("Nombre del cliente", { exact: true })).toBeDisabled();
    await expect(ficha.getByLabel("Material", { exact: true })).toBeDisabled();
    await expect(ficha.getByLabel("Tipo de residuo", { exact: true })).toBeDisabled();
    await expect(ficha.getByRole("button", { name: "Guardar cliente", exact: true })).toHaveCount(0);
    await expect(ficha.getByRole("button", { name: "Agregar ventana", exact: true })).toHaveCount(0);
    await expect(ficha.getByRole("button", { name: "Agregar documento", exact: true })).toHaveCount(0);
    await expect(
      gerencia.getByRole("form", { name: "Registrar aviso de privacidad", exact: true }),
    ).toHaveCount(0);
    await expect(gerencia.getByRole("button", { name: "Registrar movimiento", exact: true })).toHaveCount(0);
    await expect(
      gerencia.getByRole("region", { name: "06 · Aviso de privacidad", exact: true }),
    ).toBeVisible();
  } finally {
    await contextoGerencia.close();
  }
});

test("K5 conserva porcentaje y clientes activos al filtrar y limpiar la búsqueda", async ({ page }) => {
  await entrarComo(page, "despachador");
  const completo = nombreUnico("K5 completo E2E");
  await crearClienteCompleto(page, completo);
  await crearCliente(page, nombreUnico("K5 incompleto E2E"));
  await irALista(page);
  const indicador = page.getByRole("region", { name: "Indicador K5 de toda la cartera", exact: true });
  const porcentaje = indicador.getByText(/^\d+(?:[.,]\d+)?%$/);
  const totales = indicador.getByText(/^\d+ de \d+ clientes activos$/);
  await expect(porcentaje).toBeVisible();
  await expect(totales).toBeVisible();
  const porcentajeGlobal = (await porcentaje.innerText()).trim();
  const totalesGlobales = (await totales.innerText()).trim();

  await buscar(page, completo);
  await expect(filaCliente(page, completo)).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Listado de clientes" }).getByRole("row")).toHaveCount(2);
  await expect(porcentaje).toHaveText(porcentajeGlobal);
  await expect(totales).toHaveText(totalesGlobales);
  await page.getByRole("link", { name: "Limpiar filtros", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === RUTA_CLIENTES && !url.searchParams.has("q"));
  await expect(porcentaje).toHaveText(porcentajeGlobal);
  await expect(totales).toHaveText(totalesGlobales);
});

test("documentos: catálogo y nombre libre persisten al guardar y volver a abrir", async ({ page }) => {
  await entrarComo(page, "despachador");
  const nombre = nombreUnico("Catálogo cliente E2E");
  await abrirAlta(page, nombre);
  const ficha = formularioCliente(page);
  await ficha.getByRole("button", { name: "Agregar documento", exact: true }).click();
  const tipo = ficha.getByLabel("Tipo (catálogo) · documento 1", { exact: true });
  const documento = ficha.getByLabel("Nombre · documento 1", { exact: true });
  await tipo.selectOption("contrato_servicio");
  const nombreCatalogo = (await tipo.locator("option:checked").innerText()).trim();
  await expect(documento).toHaveValue(nombreCatalogo);
  await expect(documento).toHaveAttribute("readonly", "");
  const url = await guardarAlta(page, nombre);
  await page.goto(url);
  await expect(tipo).toHaveValue("contrato_servicio");
  await expect(documento).toHaveValue(nombreCatalogo);

  await tipo.selectOption("");
  await expect(documento).toBeEditable();
  await documento.fill("Requisito libre sintético E2E");
  await ficha.getByRole("button", { name: "Guardar cliente", exact: true }).click();
  await expect(ficha.getByRole("status")).toHaveText("Cliente guardado.");
  await page.reload();
  await expect(tipo).toHaveValue("");
  await expect(documento).toHaveValue("Requisito libre sintético E2E");
});
