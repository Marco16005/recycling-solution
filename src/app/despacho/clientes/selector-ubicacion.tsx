"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const ESTILO = "https://tiles.openfreemap.org/styles/liberty";
const EL_MARQUES: [number, number] = [-100.28, 20.61]; // MapLibre usa [longitud, latitud]
const redondear = (grados: number) => Math.round(grados * 1e6) / 1e6;

interface Props {
  lat: number | null;
  lng: number | null;
  alCambiar: (lat: number, lng: number) => void;
}

/** Mapa para ubicar al cliente: un clic coloca el marcador y devuelve las coordenadas. */
export function SelectorUbicacion({ lat, lng, alCambiar }: Props) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<maplibregl.Map | null>(null);
  const marcador = useRef<maplibregl.Marker | null>(null);
  const centroInicial = useRef<[number, number]>(lat !== null && lng !== null ? [lng, lat] : EL_MARQUES);
  const alCambiarActual = useRef(alCambiar);

  useEffect(() => {
    alCambiarActual.current = alCambiar;
  }, [alCambiar]);

  useEffect(() => {
    if (!contenedor.current) return;
    const nuevo = new maplibregl.Map({ container: contenedor.current, style: ESTILO, center: centroInicial.current, zoom: 12 });
    nuevo.addControl(new maplibregl.NavigationControl());
    nuevo.on("click", (evento) => alCambiarActual.current(redondear(evento.lngLat.lat), redondear(evento.lngLat.lng)));
    mapa.current = nuevo;
    return () => {
      nuevo.remove();
      mapa.current = null;
      marcador.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapa.current) return;
    if (lat === null || lng === null) {
      marcador.current?.remove();
      marcador.current = null;
      return;
    }
    if (marcador.current) marcador.current.setLngLat([lng, lat]);
    else marcador.current = new maplibregl.Marker().setLngLat([lng, lat]).addTo(mapa.current);
  }, [lat, lng]);

  return <div ref={contenedor} className="h-72 w-full rounded-lg border" role="application" aria-label="Mapa para ubicar al cliente" />;
}
