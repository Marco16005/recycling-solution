"use client";

import { useId, useRef, useState, useTransition } from "react";
import { ubicacionDesdeTextoAccion } from "@/acciones/cartera";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResultadoFallido, type Fallo } from "./resultado-fallido";

export function PegarUbicacion({ lat, lng, alCambiar, alConsultar }: { lat: number | null; lng: number | null; alConsultar: (pendiente: boolean) => void; alCambiar: (lat: number, lng: number) => void }) {
  const id = useId();
  const [texto, setTexto] = useState("");
  const [pendiente, iniciar] = useTransition();
  const [fallo, setFallo] = useState<Fallo | null>(null);
  const [error, setError] = useState("");
  const [resuelta, setResuelta] = useState<{ lat: number; lng: number; distanciaCalleM: number | null } | null>(null);
  const solicitud = useRef(0);
  function ubicar() {
    if (pendiente) return;
    const turno = ++solicitud.current;
    alConsultar(true);
    setFallo(null); setError(""); setResuelta(null);
    iniciar(async () => {
      try {
        const resultado = await ubicacionDesdeTextoAccion(texto);
        if (turno !== solicitud.current) return;
        if (!resultado.ok) { setFallo(resultado); return; }
        alCambiar(resultado.valor.lat, resultado.valor.lng);
        setResuelta(resultado.valor);
      } catch { if (turno === solicitud.current) setError("No se pudo consultar la ubicación. Revisa la conexión e inténtalo de nuevo."); }
      finally { alConsultar(false); }
    });
  }
  const vigente = resuelta && resuelta.lat === lat && resuelta.lng === lng;
  return <div className="space-y-3 rounded-lg border p-4">
    <label htmlFor={id} className="text-sm font-medium">Pegar ubicación</label>
    <div className="flex flex-wrap gap-2"><Input id={id} value={texto} className="min-w-48 flex-1" placeholder="Enlace de Maps o latitud, longitud" onChange={(e) => { solicitud.current++; setTexto(e.target.value); setFallo(null); setResuelta(null); }} /><Button type="button" variant="secondary" disabled={pendiente || !texto.trim()} onClick={ubicar}>{pendiente ? "Ubicando…" : "Ubicar en el mapa"}</Button></div>
    <p className="text-xs text-muted-foreground">Acepta ubicaciones compartidas por WhatsApp, Google Maps, Apple Maps o coordenadas. Los enlaces cortos se consultan con Google.</p>
    {fallo && <ResultadoFallido resultado={fallo} />}{error && <p role="alert">{error}</p>}
    {vigente && <p role="status" className="text-sm">{resuelta.distanciaCalleM === null ? "Pin colocado. No se pudo calcular la distancia a la calle." : `Pin a ${Math.round(resuelta.distanciaCalleM)} m de una calle: revísalo.`} Guarda el cliente para conservar la ubicación.</p>}
  </div>;
}
