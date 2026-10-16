import { devices, expect, test, type Page } from "@playwright/test";
import { prepararDiaOperador } from "./ayudas/operador";
import { entrarComo } from "./ayudas/sesion";
import type { Guardado } from "../src/components/operador/mi-ruta";
import type { EventoEntrada } from "../src/dominio/operacion/tipos";

const { defaultBrowserType: _navegador, ...telefono } = devices["Pixel 7"];
void _navegador;
test.use(telefono);

async function guardado(page: Page): Promise<Guardado> {
  return page.evaluate(() => {
    const clave = Object.keys(localStorage).find(k => k.startsWith("rs-operador:"));
    if (!clave) throw new Error("No se guardó la ruta");
    return JSON.parse(localStorage.getItem(clave)!);
  });
}
async function insertarEvento(page: Page, evento: EventoEntrada) {
  await page.evaluate(e => {
    const clave = Object.keys(localStorage).find(k => k.endsWith(`:${e.jornadaId}`))!;
    const datos = JSON.parse(localStorage.getItem(clave)!);
    datos.cola.push({ clase: "evento", entrada: e });
    localStorage.setItem(clave, JSON.stringify(datos));
    window.dispatchEvent(new Event("rs-operador-enviar"));
  }, evento);
}
async function sinPendientes(page: Page) {
  await expect.poll(async () => (await guardado(page)).cola.length).toBe(0);
  await expect(page.getByRole("status")).toContainText("0 eventos por enviar");
}
async function odometro(page: Page, boton: string, km: number) {
  await page.getByRole("button", { name: boton, exact: true }).click();
  await page.getByLabel("Odómetro (km)").fill(String(km));
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await sinPendientes(page);
}

test("operador: jornada, idempotencia, rechazo, cola sin señal e incidente con re-ruteo", async ({ page, context, browser, baseURL }) => {
  test.setTimeout(180_000);
  const dia = await prepararDiaOperador(); // Una sola preparación para todo el archivo.
  await entrarComo(page, "operador");
  await expect(page).toHaveURL(/\/operador$/);
  await expect(page.getByRole("heading", { name: "Mi ruta" })).toBeVisible();
  await expect(page.getByText("Tocar en caseta").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Abrir mapa" }).first()).toHaveAttribute("href", /^geo:/);

  // ready no implica que el mensaje de precarga haya terminado: espera también la caché.
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(async () => {
    if (!navigator.serviceWorker.controller) return false;
    const nombres = (await caches.keys()).filter(n => n.startsWith("rs-operador-"));
    if (nombres.length !== 1) return false;
    const cache = await caches.open(nombres[0]);
    const urls = [location.pathname, ...performance.getEntriesByType("resource").map(r => r.name)
      .filter(n => new URL(n).origin === location.origin && new URL(n).pathname.startsWith("/_next/static/"))];
    return (await Promise.all(urls.map(url => cache.match(url)))).every(Boolean);
  }), { timeout: 30_000 }).toBe(true);
  const paradasGuardadas = (await guardado(page)).vista.viajes.flatMap(v => v.paradas);
  expect(paradasGuardadas.length).toBeGreaterThan(0);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Mi ruta" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Sin conexión");
  for (const parada of paradasGuardadas)
    await expect(page.getByRole("article", { name: `Parada ${parada.folio}`, exact: true })).toContainText(parada.cliente.nombre);
  await page.getByRole("button", { name: "Llegué al patio", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("1 eventos por enviar");
  const encolado = (await guardado(page)).cola[0];
  if (encolado.clase !== "evento") throw new Error("Se esperaba check-in");
  await page.getByRole("button", { name: "Salgo del patio", exact: true }).click();
  await page.getByLabel("Odómetro (km)").fill("1000");
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("2 eventos por enviar");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Salir", exact: true }).click();
  await expect(page).toHaveURL(/\/operador$/);
  await context.setOffline(false);
  await sinPendientes(page);
  const checkIn = (await guardado(page)).vista.estado!.checkInEn;
  await insertarEvento(page, encolado.entrada);
  await sinPendientes(page);
  expect((await guardado(page)).vista.estado!.checkInEn).toBe(checkIn);
  expect((await guardado(page)).rechazados).toHaveLength(0);

  // Un conflicto y una entrada inválida no deben bloquear el evento válido que sigue.
  await context.setOffline(true);
  const invalido = { ...encolado.entrada, eventoId: crypto.randomUUID(), ocurridoEn: "fecha inválida" };
  const viajeInicial = (await guardado(page)).vista.estado!.viajes[0];
  const llegada: EventoEntrada = { ...encolado.entrada, eventoId: crypto.randomUUID(), tipo: "llegada",
    ocurridoEn: new Date().toISOString(), rutaId: viajeInicial.rutaId, versionRuta: viajeInicial.version,
    paradaId: viajeInicial.paradas[0].paradaId };
  await insertarEvento(page, { ...encolado.entrada, motivo: "Contenido distinto" });
  await insertarEvento(page, invalido);
  await insertarEvento(page, llegada);
  expect((await guardado(page)).cola).toHaveLength(3);
  await context.setOffline(false);
  await sinPendientes(page);
  expect((await guardado(page)).rechazados.map(r => r.eventoId)).toEqual([encolado.entrada.eventoId, invalido.eventoId]);
  await expect(page.getByRole("region", { name: "Eventos rechazados" })).toContainText("Llama al despachador");
  expect((await guardado(page)).vista.estado!.checkInEn).toBe(checkIn);
  expect((await guardado(page)).vista.estado!.viajes[0].paradas[0].estado).toBe("en_sitio");

  const antes = (await guardado(page)).vista.estado!;
  const viaje = antes.viajes[0];
  await insertarEvento(page, { ...encolado.entrada, eventoId: crypto.randomUUID(), tipo: "fin_servicio",
    ocurridoEn: new Date().toISOString(), rutaId: viaje.rutaId, versionRuta: viaje.version, paradaId: viaje.paradas[0].paradaId });
  await sinPendientes(page);
  await expect(page.getByRole("region", { name: "Eventos rechazados" })).toContainText("Llama al despachador");
  expect((await guardado(page)).vista.estado).toEqual(antes);
  expect((await guardado(page)).vista.estado!.viajes[0].salidaPatioEn).not.toBeNull();

  // El viaje ya en curso debe sobrevivir completo a la retirada de la otra jornada.
  await page.getByRole("button", { name: "Reportar incidente", exact: true }).click();
  const formulario = page.getByRole("form", { name: "Reportar incidente", exact: true });
  await formulario.getByRole("combobox", { name: "Tipo", exact: true }).selectOption("cierre_vial");
  await formulario.getByLabel("Descripción").fill("Cierre sintético de acceso E2E");
  await formulario.getByRole("button", { name: "Enviar incidente" }).click();
  await sinPendientes(page);
  const despacho = await browser.newContext({ baseURL });
  try {
    const d = await despacho.newPage();
    await entrarComo(d, "despachador");
    await d.goto(`/despacho/plan?fecha=${dia.fecha}`);
    const rechazados = d.getByRole("region", { name: "Eventos rechazados", exact: true });
    await rechazados.getByLabel("Nota de conciliación").fill("Revisado con operador: prueba de rechazo");
    await rechazados.getByRole("button", { name: "Conciliar", exact: true }).click();
    await expect(rechazados).toContainText("Sin eventos por conciliar");
    const resolver = d.getByRole("form", { name: "Resolver Cierre sintético de acceso E2E" });
    await resolver.getByLabel("Acción").selectOption("re_ruteo");
    await resolver.getByRole("button", { name: "Resolver incidente" }).click();
    await expect(resolver).toHaveCount(0);
    await d.getByRole("checkbox", { name: `No disponible: ${dia.otraPlaca}`, exact: true }).check();
    await d.getByRole("button", { name: "Generar re-ruteo", exact: true }).click();
    await expect(d).toHaveURL(/plan=/);
    await expect(d.getByText(/solicitudes congeladas conservadas/)).toBeVisible();
    for (const casilla of await d.getByRole("checkbox").all()) await casilla.check();
    await d.getByRole("button", { name: "Validar", exact: true }).click();
    await expect(d.getByText("Validado", { exact: true })).toBeVisible();
  } finally { await despacho.close(); }

  await page.reload();
  // Completa también los nuevos viajes que haya asignado el re-ruteo.
  let km = 1000;
  for (let paso = 0; paso < 50; paso++) {
    const s = (await guardado(page)).vista.estado!;
    if (s.checkOutEn) break;
    const boton = page.getByRole("region", { name: "Siguiente acción", exact: true }).getByRole("button").first();
    const texto = await boton.innerText();
    if (texto === "Salgo del patio" || texto === "Regresé al patio") await odometro(page, texto, km += 10);
    else { await boton.click(); await sinPendientes(page); }
  }
  await expect(page.getByText("Jornada terminada", { exact: true })).toBeVisible();
  const final = (await guardado(page)).vista.estado!;
  expect(final.viajes.flatMap(v => v.paradas).filter(p => p.vigente).every(p => p.estado === "completada")).toBe(true);
  expect(final.viajes.filter(v => v.salidaPatioEn).every(v => v.descargaFinEn)).toBe(true);
  await page.getByRole("button", { name: "Salir", exact: true }).click();
  await expect(page).toHaveURL(/\/entrar$/);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("rs-operador:")))).toEqual([]);
});
