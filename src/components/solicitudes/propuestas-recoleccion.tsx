"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmarPropuestasAccion, posponerPropuestaAccion, descartarPropuestaAccion } from "@/acciones/propuestas";
import type { Propuesta } from "@/dominio/solicitudes/propuestas";
import type { Recurrencia } from "@/dominio/clientes/tipos";
import { DIAS_SEMANA } from "@/dominio/clientes/etiquetas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResultadoFallido, type Fallo } from "@/components/clientes/resultado-fallido";

export type PropuestaVista = Propuesta & { nombre: string; ultimaSolicitud: string | null; recurrencia: Recurrencia | null };

function motivosDePropuesta(propuesta: PropuestaVista, fecha: string): string {
  return propuesta.motivos.map((motivo) => {
    if (motivo === "ritmo" && propuesta.ritmo) {
      const dias = Math.round((Date.parse(`${fecha}T00:00:00Z`) - Date.parse(`${propuesta.ritmo.ultima}T00:00:00Z`)) / 86400000);
      return `pide cada ~${propuesta.ritmo.dias} días; última hace ${dias}`;
    }
    const r = propuesta.recurrencia;
    if (motivo === "recurrencia" && r?.tipo === "dias_semana") {
      const nombres = [1, 2, 3, 4, 5, 6, 0].filter((dia) => r.dias.includes(dia)).map((dia) => DIAS_SEMANA[dia].toLocaleLowerCase("es-MX"));
      return `recurrencia: ${new Intl.ListFormat("es-MX", { type: "conjunction" }).format(nombres)}`;
    }
    if (motivo === "recurrencia" && r?.tipo === "cada_n_dias") return `recurrencia: cada ${r.cadaDias} días desde ${r.desde}`;
    return motivo === "recurrencia" ? "recurrencia fija" : "ritmo aprendido";
  }).join(" · ");
}

export function PropuestasRecoleccion({ fecha, propuestas, puedeConfirmar }: { fecha: string; propuestas: PropuestaVista[]; puedeConfirmar: boolean }) {
  const router = useRouter();
  const [seleccionadas, setSeleccionadas] = useState<string[]>([]);
  const [resueltas, setResueltas] = useState<string[]>([]);
  const [dias, setDias] = useState<Record<string, string>>({});
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [pendiente, iniciar] = useTransition();
  const [fallo, setFallo] = useState<Fallo | null>(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const visibles = propuestas.filter((p) => !resueltas.includes(p.clienteId));
  const ids = seleccionadas.filter((id) => visibles.some((p) => p.clienteId === id));
  function decidir(accion: "confirmar" | "posponer" | "descartar", clienteId?: string) {
    if (pendiente || !puedeConfirmar) return;
    if (accion === "confirmar" && !ids.length) return;
    setFallo(null); setError(""); setMensaje("");
    const cantidadDias = Number(dias[clienteId ?? ""] ?? "7");
    if (accion === "posponer" && (!Number.isInteger(cantidadDias) || cantidadDias < 1 || cantidadDias > 30)) { setError("Posponer requiere entre 1 y 30 días."); return; }
    iniciar(async () => {
      try {
        if (accion === "confirmar") {
          const resultado = await confirmarPropuestasAccion(fecha, ids);
          if (!resultado.ok) { setFallo(resultado); router.refresh(); return; }
          const { creadas, yaConfirmadas } = resultado.valor;
          const confirmadas = [...creadas.map((c) => c.clienteId), ...yaConfirmadas];
          setResueltas((actual) => [...actual, ...confirmadas]);
          setSeleccionadas((actual) => actual.filter((id) => !confirmadas.includes(id)));
          setMensaje(`${creadas.length} solicitudes creadas${creadas.length ? `: ${creadas.map((c) => c.folio).join(", ")}` : ""}. ${yaConfirmadas.length} ya confirmadas.`);
        } else if (clienteId) {
          const resultado = accion === "posponer" ? await posponerPropuestaAccion(fecha, clienteId, cantidadDias) : await descartarPropuestaAccion(fecha, clienteId, notas[clienteId] ?? "");
          if (!resultado.ok) { setFallo(resultado); router.refresh(); return; }
          setResueltas((actual) => [...actual, clienteId]);
          setSeleccionadas((actual) => actual.filter((id) => id !== clienteId));
          setMensaje(accion === "posponer" ? `Propuesta pospuesta ${cantidadDias} días.` : "Propuesta descartada para esta fecha.");
        }
        router.refresh();
      } catch { setError("No recibimos confirmación. Actualiza las propuestas antes de reintentar."); }
    });
  }
  return <section aria-label={`Propuestas para ${fecha}`} className="space-y-5 rounded-xl border bg-background p-5 sm:p-6">
    <div><h2 className="text-lg font-semibold">Propuestas para {fecha}</h2><p className="mt-1 text-sm text-muted-foreground">Revisa los motivos y confirma las recolecciones que correspondan.</p></div>
    {fallo && <ResultadoFallido resultado={fallo} />}{error && <div role="alert" className="space-y-2 text-sm"><p>{error}</p><Button type="button" variant="outline" disabled={pendiente} onClick={() => router.refresh()}>Actualizar propuestas</Button></div>}{mensaje && <p role="status" className="text-sm">{mensaje}</p>}
    {visibles.length === 0 ? <p className="text-sm">No hay propuestas para esta fecha.</p> : <fieldset disabled={pendiente || !puedeConfirmar} className="space-y-4">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={visibles.length > 0 && ids.length === visibles.length} onChange={(e) => setSeleccionadas(e.target.checked ? visibles.map((p) => p.clienteId) : [])} />Seleccionar todas</label>
      <ul className="space-y-4">{visibles.map((p) => <li key={p.clienteId} className="space-y-4 rounded-lg border p-4">
        <div className="flex items-start gap-3"><input type="checkbox" className="mt-1" aria-label={`Seleccionar ${p.nombre}`} checked={ids.includes(p.clienteId)} onChange={(e) => setSeleccionadas(e.target.checked ? [...ids, p.clienteId] : ids.filter((id) => id !== p.clienteId))} /><div className="min-w-0"><Link href={`/despacho/clientes/${p.clienteId}`} className="break-words font-medium underline-offset-4 hover:underline">{p.nombre}</Link><p className="mt-1 text-sm text-muted-foreground">{motivosDePropuesta(p, fecha)}</p><p className="mt-1 text-xs text-muted-foreground">Última solicitud: {p.ultimaSolicitud ?? "Sin solicitudes"}</p></div></div>
        {puedeConfirmar && <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-2 text-sm">Días a posponer<Input aria-label={`Días a posponer para ${p.nombre}`} className="w-28" type="number" min={1} max={30} value={dias[p.clienteId] ?? "7"} onChange={(e) => setDias({ ...dias, [p.clienteId]: e.target.value })} /></label>
          <Button type="button" variant="outline" onClick={() => decidir("posponer", p.clienteId)}>Posponer</Button>
          <label className="min-w-48 flex-1 space-y-2 text-sm">Nota al descartar (opcional)<Input aria-label={`Nota al descartar ${p.nombre}`} maxLength={300} value={notas[p.clienteId] ?? ""} onChange={(e) => setNotas({ ...notas, [p.clienteId]: e.target.value })} /></label>
          <Button type="button" variant="ghost" onClick={() => decidir("descartar", p.clienteId)}>Descartar</Button>
        </div>}
      </li>)}</ul>
      {puedeConfirmar && <Button type="button" disabled={ids.length === 0} onClick={() => decidir("confirmar")}>Confirmar seleccionadas</Button>}
    </fieldset>}
  </section>;
}
