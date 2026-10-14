import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Imagen de producción mínima (etapa runner del Dockerfile).
  output: "standalone",
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
