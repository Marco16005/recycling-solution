/**
 * Plan CRM, §4.2: sigue un enlace corto de Google Maps (maps.app.goo.gl, goo.gl/maps) hasta el enlace largo, que ya trae
 * coordenadas. Solo hosts de Google, hasta 3 saltos y 3 s en total; no envía nada más que el enlace mismo.
 */

const HOSTS = new Set([
  "maps.app.goo.gl", "goo.gl", "maps.google.com", "www.google.com", "google.com", "maps.google.com.mx", "www.google.com.mx", "google.com.mx",
]);
const permitido = (url: URL) => url.protocol === "https:" && HOSTS.has(url.hostname);

export async function resolverEnlaceCorto(texto: string, opciones: { fetch?: typeof fetch; plazoMs?: number; saltos?: number } = {}):
  Promise<{ ok: true; url: string } | { ok: false; motivo: string }> {
  const f = opciones.fetch ?? fetch;
  const fin = Date.now() + (opciones.plazoMs ?? 3000);
  let actual: URL;
  try {
    actual = new URL(texto.trim().split(/\s+/).find((p) => p.startsWith("https://")) ?? texto.trim());
  } catch {
    return { ok: false, motivo: "No es un enlace" };
  }
  if (!permitido(actual)) return { ok: false, motivo: "Solo se siguen enlaces de Google Maps" };
  for (let salto = 0; salto <= (opciones.saltos ?? 3); salto++) {
    const restante = fin - Date.now();
    if (restante <= 0) return { ok: false, motivo: "Google Maps no respondió a tiempo" };
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), restante);
    let respuesta: Response;
    try {
      respuesta = await f(actual.toString(), { redirect: "manual", signal: control.signal });
    } catch {
      return { ok: false, motivo: "Google Maps no respondió a tiempo" };
    } finally {
      clearTimeout(temporizador);
    }
    const destino = respuesta.status >= 300 && respuesta.status < 400 ? respuesta.headers.get("location") : null;
    // Plan de seguridad (hallazgo 6): solo importan el estado y Location; el cuerpo no se descarga.
    await respuesta.body?.cancel().catch(() => undefined);
    if (!destino) return { ok: true, url: actual.toString() };
    const siguiente = new URL(destino, actual);
    if (!permitido(siguiente)) return { ok: false, motivo: "El enlace lleva fuera de Google Maps" };
    actual = siguiente;
  }
  return { ok: false, motivo: "Demasiadas redirecciones" };
}
