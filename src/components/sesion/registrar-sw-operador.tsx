"use client";

import { useEffect } from "react";

/** Registra el service worker de /operador (Plan 5, §5). Va en el layout de /operador; no muestra nada. */
export function RegistrarSwOperador() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw-operador.js", { scope: "/operador" }).catch(() => {
      // Sin service worker (por ejemplo, sin HTTPS) la pantalla sigue funcionando con conexión.
    });
  }, []);
  return null;
}

/** Borra lo que /operador guarda en el teléfono: la ruta y la cola (localStorage `rs-operador:`), la caché y el service worker. */
export async function borrarDatosDelOperador(): Promise<void> {
  try {
    for (const clave of Object.keys(localStorage)) if (clave.startsWith("rs-operador:")) localStorage.removeItem(clave);
  } catch {
    // Sin acceso a localStorage no hay nada que borrar.
  }
  try {
    if ("caches" in window) for (const nombre of await caches.keys()) if (nombre.startsWith("rs-operador-")) await caches.delete(nombre);
    if ("serviceWorker" in navigator) for (const registro of await navigator.serviceWorker.getRegistrations()) await registro.unregister();
  } catch {
    // Se intenta de nuevo en el siguiente cierre de sesión.
  }
}
