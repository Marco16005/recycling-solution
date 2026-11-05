// Service worker de /operador (Plan 5, §5): la pantalla del operador abre sin señal.
// Red primero para la pantalla (con respaldo en caché) y caché para los archivos estáticos de Next.
// No guarda respuestas de acciones ni de la API.
// La pantalla guardada lleva datos de la ruta: la caché es de un solo usuario (se registra como /sw-operador.js?u=<id>),
// al activarse borra las de otros usuarios, y entrar o cerrar sesión la borran por completo.
const USUARIO = new URL(self.location.href).searchParams.get("u") || "sin-usuario";
const CACHE = `rs-operador-v1-${USUARIO}`;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    (async () => {
      for (const nombre of await caches.keys()) if (nombre.startsWith("rs-operador-") && nombre !== CACHE) await caches.delete(nombre);
      await self.clients.claim();
    })(),
  );
});

// La primera visita ya ocurrió cuando el worker se activa: la pantalla le manda su dirección y los recursos que cargó
// (solo del mismo origen) para dejarlos guardados y poder recargar sin señal desde el primer día.
self.addEventListener("message", (evento) => {
  // Plan de seguridad (SonarQube S2819): solo la pantalla del mismo origen puede pedir que se guarden recursos. Hoy el
  // navegador ya lo impide; esto lo deja explícito. Un origen vacío (algunos navegadores) no se rechaza: las URLs se
  // filtran al mismo origen más abajo.
  if (evento.origin && evento.origin !== self.location.origin) return;
  const datos = evento.data;
  if (!datos || datos.tipo !== "precargar" || !Array.isArray(datos.urls)) return;
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const texto of datos.urls) {
        try {
          const url = new URL(texto, self.location.origin);
          if (url.origin !== self.location.origin) continue;
          const pantalla = url.pathname.startsWith("/operador");
          if (!pantalla && !url.pathname.startsWith("/_next/static/")) continue;
          const respuesta = await fetch(url, { credentials: "same-origin" });
          if (respuesta.ok) await cache.put(pantalla ? url.pathname : url.href, respuesta);
        } catch {
          // Lo que no se pudo guardar ahora se guarda en la siguiente navegación con señal.
        }
      }
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
