"use client";

import { useState } from "react";
import type { UnidadEnPlan } from "@/consultas/plan";
import { CLASE_SELECT } from "@/components/clientes/campos-formulario";
import { Button } from "@/components/ui/button";

export type Movimiento = { tipo: "mover"; solicitudId: string; unidadId: string; viaje: number; posicion: number };

export function MoverSolicitud({ solicitudId, folio, unidades, mover }: {
  solicitudId: string; folio: string; unidades: UnidadEnPlan[];
  mover: (ajuste: Movimiento) => void;
}) {
  const [unidadId, setUnidadId] = useState(unidades[0]?.jornadaId ?? "");
  const [viaje, setViaje] = useState(1);
  const [posicion, setPosicion] = useState(1);
  // El motor retira la solicitud y elimina viajes vacíos antes de interpretar el destino.
  const viajes = (unidades.find(u => u.jornadaId === unidadId)?.viajes ?? [])
    .map(v => v.paradas.filter(p => p.solicitudId !== solicitudId)).filter(p => p.length > 0);
  const cantidadPosiciones = (viajes[viaje - 1]?.length ?? 0) + 1;
  return (
    <form aria-label={`Mover ${folio}`} className="flex flex-wrap items-end gap-3" onSubmit={e => {
      e.preventDefault();
      if (unidadId) mover({ tipo: "mover", solicitudId, unidadId, viaje, posicion });
    }}>
      <label className="min-w-44 flex-1 space-y-1 text-sm">Unidad
        <select className={CLASE_SELECT} value={unidadId} required onChange={e => {
          setUnidadId(e.target.value); setViaje(1); setPosicion(1);
        }}>
          {unidades.map(u => <option key={u.jornadaId} value={u.jornadaId}>{u.unidad.placa} · {u.operador.nombre}</option>)}
        </select>
      </label>
      <label className="space-y-1 text-sm">Viaje
        <select className={CLASE_SELECT} value={viaje} onChange={e => { setViaje(Number(e.target.value)); setPosicion(1); }}>
          {Array.from({ length: viajes.length + 1 }, (_, i) => <option key={i} value={i + 1}>
            {i + 1}{i === viajes.length ? " · nuevo" : ""}
          </option>)}
        </select>
      </label>
      <label className="space-y-1 text-sm">Posición
        <select className={CLASE_SELECT} value={posicion} onChange={e => setPosicion(Number(e.target.value))}>
          {Array.from({ length: cantidadPosiciones }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
        </select>
      </label>
      <Button type="submit" variant="outline" disabled={!unidadId}>Mover</Button>
    </form>
  );
}
