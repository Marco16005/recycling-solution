/** Plan CRM, §4.2: coordenadas desde el texto o el enlace que manda el cliente. Se implementa en PC-2. */
export type LecturaUbicacion =
  | { ok: true; lat: number; lng: number }
  | { ok: false; motivo: "enlace_corto" | "no_reconocido" | "fuera_de_mexico"; mensaje: string };

export function leerUbicacion(texto: string): LecturaUbicacion {
  void texto;
  throw new Error("pendiente: PC-2");
}
