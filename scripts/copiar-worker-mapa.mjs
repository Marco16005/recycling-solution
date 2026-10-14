// Copia el worker de MapLibre a public/ para servirlo en /maplibre-gl-worker.mjs. MapLibre lo busca junto a su propio
// archivo (import.meta.url), que el empaquetado de Next mueve; selector-ubicacion.tsx le indica esta ruta con
// setWorkerUrl. Corre antes de `next dev` y de `next build`, así la copia siempre es de la versión instalada.
import { copyFileSync } from "node:fs";

copyFileSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "public/maplibre-gl-worker.mjs");
