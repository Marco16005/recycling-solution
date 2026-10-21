import type { Ventana } from "./tipos";

/** Plan CRM, §4.1: "lun-vie 08:00-14:00; sab 09:00-12:00" ↔ ventanas. Se implementa en PC-2. */
export function leerHorarios(texto: string): { ok: true; ventanas: Ventana[] } | { ok: false; mensaje: string } {
  void texto;
  throw new Error("pendiente: PC-2");
}

/** Inversa de leerHorarios: leerHorarios(escribirHorarios(v)) da v normalizado. */
export function escribirHorarios(ventanas: Ventana[]): string {
  void ventanas;
  throw new Error("pendiente: PC-2");
}
