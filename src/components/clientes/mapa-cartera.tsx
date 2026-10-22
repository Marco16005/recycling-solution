"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { PuntoCartera } from "@/consultas/cartera.nucleo";
import "maplibre-gl/dist/maplibre-gl.css";

maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");
const ESTADOS = {
  completo_habilitado: { color: "#15803d", texto: "Completo y habilitado hoy" },
  incompleto: { color: "#b45309", texto: "Incompleto" },
  no_habilitado: { color: "#b91c1c", texto: "No habilitado" },
};
export type PuntoConMotivos = PuntoCartera & { motivos: string[] };

export function MapaCartera({ puntos, estiloMapaUrl }: { puntos: PuntoConMotivos[]; estiloMapaUrl: string }) {
  const contenedor = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!contenedor.current) return;
    let mapa: maplibregl.Map | undefined;
    let vigente = true;
    const marcadores: maplibregl.Marker[] = [];
    try {
      mapa = new maplibregl.Map({ container: contenedor.current, style: estiloMapaUrl, center: [-100.28, 20.61], zoom: 10 });
      mapa.addControl(new maplibregl.NavigationControl());
      mapa.on("error", () => { if (vigente) setError(true); });
      mapa.on("load", () => { if (vigente) setError(false); });
      const limites = new maplibregl.LngLatBounds();
      for (const punto of puntos) {
        const contenido = document.createElement("div");
        const enlace = document.createElement("a");
        enlace.href = `/despacho/clientes/${punto.clienteId}`;
        enlace.textContent = punto.nombre;
        enlace.style.textDecoration = "underline";
        contenido.append(enlace);
        const estado = document.createElement("p");
        estado.textContent = [ESTADOS[punto.estado].texto, ...punto.motivos].join(" · ");
        contenido.append(estado);
        const boton = document.createElement("button");
        boton.type = "button";
        boton.setAttribute("aria-label", punto.nombre);
        boton.style.cssText = `width:24px;height:24px;border-radius:50%;border:3px solid white;background:${ESTADOS[punto.estado].color};box-shadow:0 1px 5px #0006;cursor:pointer`;
        const marcador = new maplibregl.Marker({ element: boton }).setLngLat([punto.lng, punto.lat]).setPopup(new maplibregl.Popup({ offset: 15 }).setDOMContent(contenido)).addTo(mapa);
        marcadores.push(marcador);
        limites.extend([punto.lng, punto.lat]);
      }
      if (puntos.length) mapa.fitBounds(limites, { padding: 50, maxZoom: 14, duration: 0 });
    } catch {
      queueMicrotask(() => { if (vigente) setError(true); });
    }
    return () => { vigente = false; marcadores.forEach((m) => m.remove()); mapa?.remove(); };
  }, [puntos, estiloMapaUrl]);
  return <div className="space-y-4">
    <ul aria-label="Leyenda del mapa" className="flex flex-wrap gap-4 text-sm">{Object.entries(ESTADOS).map(([estado, { color, texto }]) => <li key={estado} className="flex items-center gap-2"><span aria-hidden="true" className="size-3 rounded-full" style={{ background: color }} />{texto}</li>)}</ul>
    <div ref={contenedor} role="region" aria-label="Mapa de clientes" className="h-[32rem] rounded-xl border" />
    {error && <p role="status" className="text-sm">No se pudo cargar el mapa. Puedes consultar los clientes en la lista de abajo.</p>}
    <ul aria-label="Clientes en el mapa" className="grid gap-3 sm:grid-cols-2">{puntos.map((punto) => <li key={punto.clienteId} className="rounded-lg border p-3 text-sm"><a href={`/despacho/clientes/${punto.clienteId}`} className="font-medium underline">{punto.nombre}</a><p className="mt-1 text-muted-foreground">{ESTADOS[punto.estado].texto}{punto.motivos.length ? ` · ${punto.motivos.join("; ")}` : ""}</p></li>)}</ul>
  </div>;
}
