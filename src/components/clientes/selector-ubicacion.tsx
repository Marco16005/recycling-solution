"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Turbopack cambia la URL relativa del worker de MapLibre; usamos la copia servida desde public.
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

const EL_MARQUES: [number, number] = [-100.28, 20.61]; // MapLibre usa [longitud, latitud]
const redondear = (grados: number) => Math.round(grados * 1e6) / 1e6;

function coordenadasValidas(lat: number | null, lng: number | null): boolean {
  return (
    lat !== null &&
    lng !== null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

interface Props {
  estiloMapaUrl: string;
  soloLectura: boolean;
  lat: number | null;
  lng: number | null;
  alCambiar: (lat: number, lng: number) => void;
}

/** Mapa para ubicar al cliente: un clic coloca el marcador y devuelve las coordenadas. */
export function SelectorUbicacion({ lat, lng, alCambiar, estiloMapaUrl, soloLectura }: Props) {
  const [error, setError] = useState(false);
  const lecturaActual = useRef(soloLectura);
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<maplibregl.Map | null>(null);
  const marcador = useRef<maplibregl.Marker | null>(null);
  const centroInicial = useRef<[number, number]>(coordenadasValidas(lat, lng) ? [lng!, lat!] : EL_MARQUES);
  const alCambiarActual = useRef(alCambiar);

  useEffect(() => {
    alCambiarActual.current = alCambiar;
    lecturaActual.current = soloLectura;
  }, [alCambiar, soloLectura]);

  useEffect(() => {
    if (!contenedor.current) return;
    let nuevo: maplibregl.Map;
    let vigente = true;
    try {
      nuevo = new maplibregl.Map({
        container: contenedor.current,
        style: estiloMapaUrl,
        center: centroInicial.current,
        zoom: 12,
      });
    } catch {
      queueMicrotask(() => {
        if (vigente) setError(true);
      });
      return () => {
        vigente = false;
      };
    }
    nuevo.on("error", () => setError(true));
    nuevo.on("load", () => setError(false));
    nuevo.addControl(new maplibregl.NavigationControl());
    nuevo.on("click", (evento) => {
      if (!lecturaActual.current)
        alCambiarActual.current(redondear(evento.lngLat.lat), redondear(evento.lngLat.lng));
    });
    mapa.current = nuevo;
    return () => {
      vigente = false;
      nuevo.remove();
      mapa.current = null;
      marcador.current = null;
    };
  }, [estiloMapaUrl]);

  useEffect(() => {
    if (!mapa.current) return;
    if (!coordenadasValidas(lat, lng)) {
      marcador.current?.remove();
      marcador.current = null;
      return;
    }
    if (marcador.current) marcador.current.setLngLat([lng!, lat!]);
    else marcador.current = new maplibregl.Marker().setLngLat([lng!, lat!]).addTo(mapa.current);
    mapa.current.jumpTo({ center: [lng!, lat!] });
  }, [lat, lng, estiloMapaUrl]);

  return (
    <div className="space-y-2">
      <div
        ref={contenedor}
        className="h-72 w-full rounded-lg border"
        role="region"
        aria-label={soloLectura ? "Ubicación del cliente en el mapa" : "Mapa para ubicar al cliente"}
      />
      {error && (
        <p role="status" className="text-sm text-muted-foreground">
          No se pudo cargar el mapa. Puedes consultar o capturar las coordenadas en los campos de arriba.
        </p>
      )}
    </div>
  );
}
