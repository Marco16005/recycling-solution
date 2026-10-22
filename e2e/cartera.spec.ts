import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import Papa from "papaparse";
import { sembrarCarteraCrm } from "./ayudas/cartera";
import { nombreUnico } from "./ayudas/datos";
import { entrarComo } from "./ayudas/sesion";

const RUTA = "/despacho/clientes";

function filaCliente(page: Page, nombre: string) {
  return page.getByRole("region", { name: "Listado de clientes", exact: true })
    .getByRole("row").filter({ has: page.getByRole("link", { name: nombre, exact: true }) });
}

async function descargarCsv(page: Page, enlace: string, ruta: string) {
  const respuestaPendiente = page.waitForResponse((r) => new URL(r.url()).pathname === ruta && r.request().method() === "GET");
  const descargaPendiente = page.waitForEvent("download");
  await page.getByRole("link", { name: enlace, exact: true }).click();
  const respuesta = await respuestaPendiente;
  expect(respuesta.status()).toBe(200);
  expect(respuesta.headers()["content-type"]).toMatch(/^text\/csv\b/);
  const descarga = await descargaPendiente;
  expect(await descarga.failure()).toBeNull();
  const archivo = await descarga.path();
  expect(archivo).not.toBeNull();
  // Leer los bytes descargados: text() puede ocultar el BOM y Chromium no siempre conserva el cuerpo de una descarga.
  const bytes = await readFile(archivo!);
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const contenido = bytes.toString("utf8").replace(/^\uFEFF/, "");
  expect(contenido).toContain("\r\n");
  return { contenido, url: new URL(respuesta.url()) };
}

test("cartera: descargar plantilla e importar una fila con todos los datos operativos", async ({ page }) => {
  test.setTimeout(90000);
  await entrarComo(page, "despachador");
  await page.getByRole("link", { name: "Importar CSV", exact: true }).click();
  const { contenido } = await descargarCsv(page, "Descargar plantilla", "/api/clientes/plantilla");
  const plantilla = Papa.parse<string[]>(contenido, { skipEmptyLines: true });
  expect(plantilla.errors).toEqual([]);
  const columnas = plantilla.data[0];
  expect(columnas).toEqual([
    "nombre", "contacto", "telefono", "direccion", "lat", "lng", "residuo", "material", "servicio_min", "carga_kg",
    "horarios", "tipos_unidad", "notas_acceso", "ubicacion", "correo", "puesto",
  ]);
  const nombre = nombreUnico("CRM CSV completo");
  const datos: Record<string, string> = {
    nombre, contacto: "Contacto sintético", telefono: "4425550101", direccion: "Calle sintética 20, Querétaro",
    lat: "20.62", lng: "-100.3", residuo: "RME", material: "Cartón", servicio_min: "30", carga_kg: "800",
    horarios: "lun-dom 08:00-16:00", tipos_unidad: "doble_rodada|rabon", notas_acceso: "Registrarse en caseta",
    ubicacion: "https://maps.google.com/?q=20.62,-100.3", correo: "contacto@ejemplo.test", puesto: "Almacén",
  };
  const csv = "\uFEFF" + Papa.unparse([columnas, columnas.map((c) => datos[c])], { newline: "\r\n" });
  await page.getByLabel("Archivo CSV", { exact: true }).setInputFiles({ name: "cartera-completa.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Analizar archivo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "2 · Revisar y confirmar", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "2 · Revisar y confirmar", exact: true }).getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Confirmar importación", exact: true }).click();
  await expect(page.getByRole("heading", { name: "1 clientes importados", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Ver clientes", exact: true }).click();
  await filaCliente(page, nombre).getByRole("link", { name: nombre, exact: true }).click();
  const ficha = page.getByRole("form", { name: "Ficha del cliente", exact: true });
  for (const [campo, valor] of [
    ["Nombre del cliente", nombre], ["Nombre del contacto", datos.contacto], ["Teléfono", datos.telefono],
    ["Dirección", datos.direccion], ["Latitud", datos.lat], ["Longitud", datos.lng], ["Tipo de residuo", "RME"],
    ["Material", "Cartón"], ["Tiempo de servicio (minutos)", "30"], ["Carga estimada (kg)", "800"],
    ["Notas de acceso", datos.notas_acceso], ["Correo electrónico", datos.correo], ["Puesto", datos.puesto],
  ]) await expect(ficha.getByLabel(campo, { exact: true })).toHaveValue(valor);
  await expect(ficha.getByRole("checkbox", { name: "Doble rodada", exact: true })).toBeChecked();
  await expect(ficha.getByRole("checkbox", { name: "Rabón", exact: true })).toBeChecked();
  await expect(ficha.getByLabel(/^Día · ventana /)).toHaveCount(7);
  for (let i = 1; i <= 7; i++) {
    await expect(ficha.getByLabel(`Día · ventana ${i}`, { exact: true })).toHaveValue(String(i - 1));
    await expect(ficha.getByLabel("Hora de inicio", { exact: true }).nth(i - 1)).toHaveValue("08:00");
    await expect(ficha.getByLabel("Hora de fin", { exact: true }).nth(i - 1)).toHaveValue("16:00");
  }
  const privacidad = page.getByRole("region", { name: "06 · Aviso de privacidad", exact: true });
  await privacidad.getByLabel("Movimiento", { exact: true }).selectOption("aceptado");
  await privacidad.getByLabel("Medio de registro", { exact: true }).selectOption("papel");
  await privacidad.getByRole("button", { name: "Registrar movimiento", exact: true }).click();
  await expect(privacidad.getByText("Aviso dado a conocer sin oposición", { exact: true })).toBeVisible();
  await page.goto(RUTA);
  await expect(filaCliente(page, nombre).getByText("Completa", { exact: true })).toBeVisible();
  await expect(filaCliente(page, nombre).getByText("Habilitada hoy", { exact: true })).toBeVisible();
});

test("cartera: pegar ubicación compartida coloca el pin, muestra distancia y persiste", async ({ page }) => {
  const { sinUbicacion } = await sembrarCarteraCrm();
  await entrarComo(page, "despachador");
  await page.goto(`${RUTA}/${sinUbicacion.id}`);
  const ficha = page.getByRole("form", { name: "Ficha del cliente", exact: true });
  await expect(ficha.getByLabel("Latitud", { exact: true })).toHaveValue("");
  await ficha.getByLabel("Pegar ubicación", { exact: true }).fill("https://maps.google.com/?q=20.62,-100.3");
  await ficha.getByRole("button", { name: "Ubicar en el mapa", exact: true }).click();
  await expect(ficha.getByLabel("Latitud", { exact: true })).toHaveValue("20.62");
  await expect(ficha.getByLabel("Longitud", { exact: true })).toHaveValue("-100.3");
  // Compose e2e incluye OSRM con el mapa sintético; una distancia ausente es una regresión.
  await expect(ficha.getByRole("status").filter({ hasText: /^Pin a \d+ m de una calle: revísalo\./ })).toBeVisible();
  const mapa = ficha.getByRole("region", { name: "Mapa para ubicar al cliente", exact: true });
  await expect(mapa.locator(".maplibregl-marker")).toBeVisible();
  await ficha.getByRole("button", { name: "Guardar cliente", exact: true }).click();
  await expect(ficha.getByRole("status").filter({ hasText: /^Cliente guardado\.$/ })).toBeVisible();
  await page.reload();
  await expect(ficha.getByLabel("Latitud", { exact: true })).toHaveValue("20.62");
  await expect(ficha.getByLabel("Longitud", { exact: true })).toHaveValue("-100.3");
  await expect(mapa.locator(".maplibregl-marker")).toBeVisible();
});

test("cartera: agregar y corregir una nota conserva la última versión al recargar", async ({ page }) => {
  const { documentoPorVencer } = await sembrarCarteraCrm();
  await entrarComo(page, "despachador");
  await page.goto(`${RUTA}/${documentoPorVencer.id}`);
  const notas = page.getByRole("region", { name: "Notas de seguimiento", exact: true });
  await expect(notas.getByText("No escribas datos sensibles", { exact: true })).toBeVisible();
  await notas.getByRole("combobox", { name: "Tipo de nota", exact: true }).selectOption("acuerdo");
  const original = "Acuerdo sintético: recibir en puerta uno.";
  const corregida = "Acuerdo sintético corregido: recibir en puerta dos.";
  await notas.getByRole("textbox", { name: "Texto de la nota", exact: true }).fill(original);
  await notas.getByRole("button", { name: "Agregar nota", exact: true }).click();
  const nota = notas.getByRole("listitem").filter({ hasText: original });
  await expect(nota).toBeVisible();
  await nota.getByRole("button", { name: /^Corregir nota de / }).click();
  await expect(notas.getByRole("textbox", { name: "Texto de la nota", exact: true })).toHaveValue(original);
  await notas.getByRole("textbox", { name: "Texto de la nota", exact: true }).fill(corregida);
  await notas.getByRole("button", { name: "Guardar corrección", exact: true }).click();
  await expect(notas.getByRole("listitem").filter({ hasText: corregida })).toContainText("corregida");
  await page.reload();
  await expect(notas.getByRole("listitem")).toHaveCount(1);
  await expect(notas.getByRole("listitem")).toContainText(corregida);
  await expect(notas.getByRole("listitem")).toContainText("acuerdo");
  await expect(notas.getByText(original, { exact: true })).toHaveCount(0);
});

test("cartera: filtros de ubicación y documentos se conservan al exportar CSV", async ({ page }) => {
  const { sinUbicacion, documentoPorVencer, ritmo } = await sembrarCarteraCrm();
  await entrarComo(page, "despachador");
  await page.goto(RUTA);
  const filtros = page.getByRole("region", { name: "Filtros", exact: true });
  await filtros.getByRole("checkbox", { name: "Sin ubicación", exact: true }).check();
  await filtros.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page).toHaveURL((u) => u.searchParams.get("sinUbicacion") === "1");
  await expect(filaCliente(page, sinUbicacion.nombre)).toBeVisible();
  await expect(filaCliente(page, documentoPorVencer.nombre)).toHaveCount(0);
  const sinPin = await descargarCsv(page, "Exportar CSV", "/api/clientes/csv");
  expect(sinPin.url.searchParams.get("sinUbicacion")).toBe("1");
  const sinPinFilas = Papa.parse<Record<string, string>>(sinPin.contenido, { header: true, skipEmptyLines: true });
  expect(sinPinFilas.errors).toEqual([]);
  expect(sinPinFilas.data.map((c) => c.nombre)).toContain(sinUbicacion.nombre);
  expect(sinPinFilas.data.map((c) => c.nombre)).not.toContain(documentoPorVencer.nombre);
  for (const cliente of sinPinFilas.data) { expect(cliente.lat).toBe(""); expect(cliente.lng).toBe(""); }

  await filtros.getByRole("link", { name: "Limpiar filtros", exact: true }).click();
  // Esperar al formulario nuevo (casilla sin marcar): si no, se vuelve a pintar y pierde la selección.
  await expect(page).toHaveURL((u) => u.pathname === RUTA && u.search === "");
  await expect(filtros.getByRole("checkbox", { name: "Sin ubicación", exact: true })).not.toBeChecked();
  await filtros.getByRole("combobox", { name: "Documentos", exact: true }).selectOption("por_vencer");
  await filtros.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page).toHaveURL((u) => u.searchParams.get("documentos") === "por_vencer" && !u.searchParams.has("sinUbicacion"));
  await expect(filaCliente(page, documentoPorVencer.nombre).getByText("Documento por vencer", { exact: true })).toBeVisible();
  await expect(filaCliente(page, sinUbicacion.nombre)).toHaveCount(0);
  await expect(filaCliente(page, ritmo.nombre)).toHaveCount(0);
  const documentos = await descargarCsv(page, "Exportar CSV", "/api/clientes/csv");
  expect(documentos.url.searchParams.get("documentos")).toBe("por_vencer");
  expect(documentos.url.searchParams.has("sinUbicacion")).toBe(false);
  const filas = Papa.parse<Record<string, string>>(documentos.contenido, { header: true, skipEmptyLines: true });
  expect(filas.errors).toEqual([]);
  expect(filas.data.map((c) => c.nombre)).toContain(documentoPorVencer.nombre);
  expect(filas.data.map((c) => c.nombre)).not.toContain(sinUbicacion.nombre);
  expect(filas.data.map((c) => c.nombre)).not.toContain(ritmo.nombre);
});

test("cartera: abrir mapa muestra al cliente con pin y cuenta al cliente sin ubicación", async ({ page }) => {
  const { ritmo, sinUbicacion } = await sembrarCarteraCrm();
  await entrarComo(page, "despachador");
  await page.goto(`${RUTA}?q=${encodeURIComponent(ritmo.nombre)}`);
  await page.getByRole("link", { name: "Mapa de la cartera", exact: true }).click();
  await expect(page).toHaveURL((u) => u.pathname === `${RUTA}/mapa` && u.searchParams.get("q") === ritmo.nombre);
  await expect(page.getByRole("heading", { name: "Mapa de la cartera", exact: true })).toBeVisible();
  const mapa = page.getByRole("region", { name: "Mapa de clientes", exact: true });
  await mapa.getByRole("button", { name: ritmo.nombre, exact: true }).click();
  await expect(mapa.getByRole("link", { name: ritmo.nombre, exact: true })).toHaveAttribute("href", `${RUTA}/${ritmo.id}`);
  await expect(page.getByRole("list", { name: "Clientes en el mapa", exact: true }).getByRole("link", { name: ritmo.nombre, exact: true })).toBeVisible();
  const filtros = page.getByRole("region", { name: "Filtros", exact: true });
  await filtros.getByRole("textbox", { name: "Buscar clientes", exact: true }).fill(sinUbicacion.nombre);
  await filtros.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "1 clientes sin ubicación no tienen pin en el mapa." })).toBeVisible();
  await expect(mapa.getByRole("button", { name: sinUbicacion.nombre, exact: true })).toHaveCount(0);
  await expect(page.getByText("No hay clientes con ubicación para estos filtros.", { exact: true })).toBeVisible();
});

// Reasignadas a Claude (Codex sin cuota el 2026-10-22); Codex las revisa.
test("cartera: confirmar una propuesta la manda a la cola con canal «Propuesta del sistema»", async ({ page }) => {
  const { fechaPropuestas, ritmo } = await sembrarCarteraCrm();
  await entrarComo(page, "despachador");
  await page.goto(`/despacho/solicitudes?fecha=${fechaPropuestas}`);
  const propuestas = page.getByRole("region", { name: `Propuestas para ${fechaPropuestas}`, exact: true });
  await expect(propuestas.getByRole("link", { name: ritmo.nombre, exact: true })).toBeVisible();
  await propuestas.getByRole("checkbox", { name: `Seleccionar ${ritmo.nombre}`, exact: true }).check();
  await propuestas.getByRole("button", { name: "Confirmar seleccionadas", exact: true }).click();
  await expect(propuestas.getByRole("status").filter({ hasText: /^1 solicitudes creadas: S-\S+\. 0 ya confirmadas\.$/ })).toBeVisible();
  await expect(propuestas.getByRole("link", { name: ritmo.nombre, exact: true })).toHaveCount(0);
  const enCola = page.getByRole("region", { name: "Cola de solicitudes", exact: true }).getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: ritmo.nombre, exact: true }) })
    .filter({ hasText: "Propuesta del sistema" });
  await expect(enCola).toHaveCount(1);
  await page.reload();
  await expect(propuestas.getByRole("link", { name: ritmo.nombre, exact: true })).toHaveCount(0);
  await expect(enCola).toHaveCount(1);
});

test("cartera: importar un CSV en Windows-1252 conserva los acentos", async ({ page }) => {
  await entrarComo(page, "despachador");
  await page.getByRole("link", { name: "Importar CSV", exact: true }).click();
  const nombre = nombreUnico("Cartonera Peñuelas");
  const csv = `nombre,direccion,residuo\r\n${nombre},Querétaro centro,RME\r\n`;
  await page.getByLabel("Archivo CSV", { exact: true }).setInputFiles({ name: "cartera-excel.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "latin1") });
  await page.getByRole("button", { name: "Analizar archivo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "2 · Revisar y confirmar", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar importación", exact: true }).click();
  await expect(page.getByRole("heading", { name: "1 clientes importados", exact: true })).toBeVisible();
  await page.goto(`${RUTA}?q=${encodeURIComponent(nombre)}`);
  await filaCliente(page, nombre).getByRole("link", { name: nombre, exact: true }).click();
  const ficha = page.getByRole("form", { name: "Ficha del cliente", exact: true });
  await expect(ficha.getByLabel("Nombre del cliente", { exact: true })).toHaveValue(nombre);
  await expect(ficha.getByLabel("Dirección", { exact: true })).toHaveValue("Querétaro centro");
});
