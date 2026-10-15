"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { VistaPlan } from "@/consultas/plan";

maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");
const COLORES = ["#0369a1", "#a21caf", "#15803d", "#c2410c", "#4338ca", "#be123c"];

export function MapaPlan({ vista }: { vista: VistaPlan }) {
  const contenedor = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  const { patio, unidades, estiloMapaUrl } = vista;
  useEffect(() => {
    if (!contenedor.current || !patio) return;
    let mapa: maplibregl.Map | undefined;
    let vigente = true;
    const fallo = () => { if (vigente) setError(true); };
    try {
      mapa = new maplibregl.Map({ container: contenedor.current, style: estiloMapaUrl, center: [patio.lng, patio.lat], zoom: 12 });
      const actual = mapa;
      actual.addControl(new maplibregl.NavigationControl());
      actual.on("error", fallo);
      actual.on("load", () => {
        if (!vigente) return;
        setError(false);
        const origen: [number, number] = [patio.lng, patio.lat];
        const limites = new maplibregl.LngLatBounds(origen, origen);
        new maplibregl.Marker({ color: "#111827" }).setLngLat(origen)
          .setPopup(new maplibregl.Popup().setText("Patio")).addTo(actual);
        unidades.forEach((u, i) => {
          const color = COLORES[i % COLORES.length];
          u.viajes.forEach(v => {
            const coordenadas: [number, number][] = [origen, ...v.paradas.map(p => [p.cliente.lng, p.cliente.lat] as [number, number]), origen];
            const id = `ruta-${i}-${v.numero}`;
            actual.addSource(id, { type: "geojson", data: {
              type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coordenadas },
            } });
            actual.addLayer({ id, type: "line", source: id, paint: { "line-color": color, "line-width": 3 } });
            v.paradas.forEach(p => {
              const punto: [number, number] = [p.cliente.lng, p.cliente.lat];
              limites.extend(punto);
              new maplibregl.Marker({ color }).setLngLat(punto).setPopup(new maplibregl.Popup().setText(
                `${u.unidad.placa} · Viaje ${v.numero} · ${p.secuencia}. ${p.folio} · ${p.cliente.nombre}`,
              )).addTo(actual);
            });
          });
        });
        actual.fitBounds(limites, { padding: 48, maxZoom: 14, duration: 0 });
      });
    } catch { queueMicrotask(fallo); }
    return () => { vigente = false; mapa?.remove(); };
  }, [patio, unidades, estiloMapaUrl]);
  if (!patio) return <p>Falta configurar la ubicación del patio.</p>;
  return <section aria-label="Mapa de rutas" className="space-y-3">
    <h2 className="text-xl font-semibold">Rutas del día</h2>
    <p className="text-sm text-muted-foreground">Líneas entre paradas; no representan el recorrido por calles. El detalle de cada viaje está debajo.</p>
    <div ref={contenedor} role="region" aria-label="Patio y paradas en el mapa" className="h-80 rounded-xl border" />
    {error && <p role="status">No se pudo cargar el mapa. Consulta las paradas en el detalle de viajes.</p>}
    <ul aria-label="Colores de las unidades" className="flex flex-wrap gap-4 text-sm">
      {unidades.map((u, i) => <li key={u.jornadaId} className="flex items-center gap-2">
        <span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ backgroundColor: COLORES[i % COLORES.length] }} />{u.unidad.placa}
      </li>)}
    </ul>
  </section>;
}
