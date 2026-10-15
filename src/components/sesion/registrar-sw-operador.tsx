"use client";

import { useEffect } from "react";

/**
 * Registra el service worker de /operador (Plan 5, §5). Va en el layout de /operador; no muestra nada.
 * usuarioId liga la caché a este usuario: otro usuario en el mismo teléfono no ve la ruta guardada.
 */
export function RegistrarSwOperador({ usuarioId }: { usuarioId: string }) {
  useEffect(() => {
    // Lo que otro usuario dejó en este teléfono (su ruta y su cola) no se conserva.
    try {
      for (const clave of Object.keys(localStorage)) {
        if (clave.startsWith("rs-operador:") && !clave.startsWith(`rs-operador:${usuarioId}:`)) localStorage.removeItem(clave);
      }
    } catch {
      // Sin acceso a localStorage no hay nada que purgar.
    }
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(`/sw-operador.js?u=${encodeURIComponent(usuarioId)}`, { scope: "/operador" }).catch(() => {
      // Sin service worker (por ejemplo, sin HTTPS) la pantalla sigue funcionando con conexión.
    });
  }, [usuarioId]);
  return null;
}

/**
 * Borra lo que /operador guarda en el teléfono: la ruta y la cola (localStorage `rs-operador:`), la caché y el service
 * worker. Cerrar sesión lo llama siempre, aunque falle la red. Entrar llama solo a la parte de caché (soloCache): así no
 * se pierde la cola sin enviar del mismo operador que vuelve a entrar; la pantalla /operador purga la de otros usuarios.
 */
export async function borrarDatosDelOperador(opciones: { soloCache?: boolean } = {}): Promise<void> {
  if (!opciones.soloCache) {
    try {
      for (const clave of Object.keys(localStorage)) if (clave.startsWith("rs-operador:")) localStorage.removeItem(clave);
    } catch {
      // Sin acceso a localStorage no hay nada que borrar.
    }
  }
  try {
    if ("caches" in window) for (const nombre of await caches.keys()) if (nombre.startsWith("rs-operador-")) await caches.delete(nombre);
    if ("serviceWorker" in navigator) for (const registro of await navigator.serviceWorker.getRegistrations()) await registro.unregister();
  } catch {
    // Se intenta de nuevo en el siguiente cierre de sesión.
  }
}
