import type { NextConfig } from "next";
import { ENCABEZADOS_FIJOS } from "./src/seguridad/encabezados";

const nextConfig: NextConfig = {
  // Imagen de producción mínima (etapa runner del Dockerfile).
  output: "standalone",
  // Plan de seguridad (S5): no anunciar la tecnología del servidor y poner los encabezados fijos en toda respuesta.
  // La política de contenido y HSTS dependen del entorno y los pone src/proxy.ts.
  poweredByHeader: false,
  // Plan de seguridad (BREACH, 2026-11-07): Next no comprime. Caddy comprime solo los archivos estáticos
  // (infra/caddy/Caddyfile): una página comprimida puede reunir texto controlado desde otro sitio con datos privados.
  compress: false,
  async headers() {
    return [{ source: "/:path*", headers: ENCABEZADOS_FIJOS }];
  },
  // Activado explícitamente: lo que lee sesión o base va dentro de <Suspense>.
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Holgura sobre el límite de 1 MB del CSV de importación.
    serverActions: { bodySizeLimit: "2mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
