import { useSyncExternalStore } from "react";

const sinSuscripcion = () => () => {};

/** false en el servidor y antes de hidratar; true en el navegador. Evita envíos nativos antes de que React controle el formulario. */
export function useHidratado(): boolean {
  return useSyncExternalStore(sinSuscripcion, () => true, () => false);
}
