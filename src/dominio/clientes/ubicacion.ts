/** Plan CRM, §4.2: coordenadas desde el texto o el enlace que manda el cliente. Pura: los enlaces cortos los sigue la acción. */
export type LecturaUbicacion =
  | { ok: true; lat: number; lng: number }
  | { ok: false; motivo: "enlace_corto" | "no_reconocido" | "fuera_de_mexico"; mensaje: string };

/** La misma caja que valida el esquema del cliente. */
const MEXICO = { latMin: 14.5, latMax: 32.8, lngMin: -118.5, lngMax: -86.5 };
const NUM = String.raw`(-?\d{1,3}(?:\.\d+)?)`;
const ENLACE_CORTO = /\b(?:maps\.app\.goo\.gl|goo\.gl\/maps)\//i;

/** En orden: el lugar marcado (!3d!4d) manda sobre la vista del mapa (@). */
const PATRONES = [
  new RegExp(String.raw`!3d${NUM}!4d${NUM}`),
  new RegExp(String.raw`[?&](?:q|query|ll|daddr|destination)=${NUM}(?:,|%2C)\s*${NUM}`, "i"),
  new RegExp(String.raw`@${NUM},${NUM}`),
  new RegExp(String.raw`^geo:${NUM},${NUM}`, "i"),
  new RegExp(String.raw`^\s*${NUM}\s*,\s*${NUM}\s*$`),
];

export function leerUbicacion(texto: string): LecturaUbicacion {
  const limpio = texto.trim();
  if (ENLACE_CORTO.test(limpio)) {
    return { ok: false, motivo: "enlace_corto", mensaje: "Enlace corto: pégalo en la ficha del cliente para resolverlo, o copia el enlace largo" };
  }
  for (const patron of PATRONES) {
    const m = patron.exec(limpio);
    if (!m) continue;
    const lat = Number(m[1]), lng = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) break;
    if (lat < MEXICO.latMin || lat > MEXICO.latMax || lng < MEXICO.lngMin || lng > MEXICO.lngMax) {
      return { ok: false, motivo: "fuera_de_mexico", mensaje: "La ubicación queda fuera de México; revisa si latitud y longitud están invertidas" };
    }
    return { ok: true, lat, lng };
  }
  return {
    ok: false, motivo: "no_reconocido",
    mensaje: "No se encontraron coordenadas. En Google Maps, toca el punto y usa Compartir → Copiar coordenadas, o pega el enlace de ubicación de WhatsApp",
  };
}
