// Service worker de /operador (Plan 5, §5): la pantalla del operador abre sin señal.
// Red primero para la pantalla (con respaldo en caché) y caché para los archivos estáticos de Next.
// No guarda respuestas de acciones ni de la API. Al cerrar sesión, la pantalla borra esta caché.
const CACHE = "rs-operador-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    (async () => {
      for (const nombre of await caches.keys()) if (nombre.startsWith("rs-operador-") && nombre !== CACHE) await caches.delete(nombre);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (evento) => {
  const peticion = evento.request;
  if (peticion.method !== "GET") return;
  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin) return;

  if (peticion.mode === "navigate" && url.pathname.startsWith("/operador")) {
    evento.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const respuesta = await fetch(peticion);
          if (respuesta.ok) await cache.put(url.pathname, respuesta.clone());
          return respuesta;
        } catch {
          return (await cache.match(url.pathname)) ?? (await cache.match("/operador")) ?? Response.error();
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/maplibre-gl-worker.mjs") {
    evento.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const guardada = await cache.match(peticion);
        if (guardada) return guardada;
        const respuesta = await fetch(peticion);
        if (respuesta.ok) await cache.put(peticion, respuesta.clone());
        return respuesta;
      })(),
    );
  }
});
