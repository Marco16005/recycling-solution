"use client";

import dynamic from "next/dynamic";

export const MapaCarteraDinamico = dynamic(() => import("./mapa-cartera").then((m) => m.MapaCartera), {
  ssr: false,
  loading: () => <p role="status" className="flex h-96 items-center justify-center rounded-xl border">Cargando mapa…</p>,
});
