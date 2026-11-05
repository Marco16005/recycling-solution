"use client";

import { authClient } from "@/seguridad/auth-cliente";

/**
 * Plan de seguridad (hallazgo 4): si al tocar «Salir» el servidor no recibió el cierre (sin señal), el teléfono ya
 * borró la ruta, pero la sesión sigue abierta en el servidor. Se anota aquí y /entrar la vuelve a cerrar en cuanto
 * carga, que es cuando ya hay red.
 */
const CLAVE = "rs-salida-pendiente";

export function marcarSalidaPendiente(): void {
  try {
    sessionStorage.setItem(CLAVE, "1");
  } catch {
    // Sin almacenamiento no se puede reintentar solo; el aviso de /entrar no aparecerá.
  }
}

/** true si había una salida pendiente y no se pudo completar todavía. */
export async function completarSalidaPendiente(): Promise<boolean> {
  let pendiente = false;
  try {
    pendiente = sessionStorage.getItem(CLAVE) === "1";
  } catch {
    return false;
  }
  if (!pendiente) return false;
  try {
    const { error } = await authClient.signOut();
    if (error) return true;
  } catch {
    return true;
  }
  try {
    sessionStorage.removeItem(CLAVE);
  } catch {
    // Nada que limpiar.
  }
  return false;
}
