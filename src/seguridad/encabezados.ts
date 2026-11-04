/**
 * Plan de seguridad (S5): encabezados que dependen de la configuración del servidor. Los fijos (nosniff, marcos,
 * referer, permisos) están en next.config.ts. La política de contenido y HSTS se arman en src/proxy.ts en cada
 * petición, porque dependen de MAPA_ESTILO_URL y BETTER_AUTH_URL, que se leen al arrancar y no al compilar.
 *
 * script-src lleva 'unsafe-inline': Next escribe en línea los datos de React Server Components, y los nonces
 * obligarían a renderizar cada página en cada petición (rompe Cache Components). La política sigue impidiendo
 * cargar scripts de otros dominios, incrustar la aplicación en marcos y enviar formularios fuera.
 */
const ESTILO_MAPA_POR_OMISION = "https://tiles.openfreemap.org/styles/liberty";

export interface EntornoEncabezados {
  MAPA_ESTILO_URL?: string;
  BETTER_AUTH_URL?: string;
  NODE_ENV?: string;
}

/** Origen http(s) de una URL, o null si no es válida. */
export function origenDe(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

export function politicaDeContenido(entorno: EntornoEncabezados): string {
  const mapa = origenDe(entorno.MAPA_ESTILO_URL || ESTILO_MAPA_POR_OMISION);
  const externo = mapa ? ` ${mapa}` : "";
  const desarrollo = entorno.NODE_ENV === "development";
  const directivas = [
    "default-src 'self'",
    // next dev usa eval para recargar en caliente; la imagen de producción no.
    `script-src 'self' 'unsafe-inline'${desarrollo ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${externo}`,
    `font-src 'self' data:${externo}`,
    `connect-src 'self'${externo}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (origenDe(entorno.BETTER_AUTH_URL)?.startsWith("https:")) directivas.push("upgrade-insecure-requests");
  return directivas.join("; ");
}

/** Encabezados por petición: la política de contenido siempre; HSTS solo si la aplicación se sirve con https. */
export function encabezadosDinamicos(entorno: EntornoEncabezados): [string, string][] {
  const encabezados: [string, string][] = [["Content-Security-Policy", politicaDeContenido(entorno)]];
  if (origenDe(entorno.BETTER_AUTH_URL)?.startsWith("https:")) {
    encabezados.push(["Strict-Transport-Security", "max-age=31536000"]);
  }
  return encabezados;
}

/** Encabezados fijos de toda respuesta (next.config.ts). */
export const ENCABEZADOS_FIJOS: { key: string; value: string }[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  // Los enlaces a Waze y Google Maps no reciben la dirección de la página de origen.
  { key: "Referrer-Policy", value: "same-origin" },
  // La aplicación no usa cámara, micrófono, ubicación del navegador ni pagos.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];
