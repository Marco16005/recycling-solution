"use client";

import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { agregarNotaAccion } from "@/acciones/cartera";
import type { TipoNota } from "@/acciones/cartera.nucleo";
import type { NotaVista } from "@/consultas/cartera.nucleo";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CLASE_SELECT } from "./campos-formulario";
import { ResultadoFallido, type Fallo } from "./resultado-fallido";

export function NotasCliente({ clienteId, notas, puedeAnotar }: { clienteId: string; notas: NotaVista[]; puedeAnotar: boolean }) {
  const id = useId();
  const router = useRouter();
  const campo = useRef<HTMLTextAreaElement>(null);
  const [tipo, setTipo] = useState<TipoNota>("llamada");
  const [texto, setTexto] = useState("");
  const [corrigeA, setCorrigeA] = useState<string | undefined>();
  const [pendiente, iniciar] = useTransition();
  const [fallo, setFallo] = useState<Fallo | null>(null);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  function guardar(evento: FormEvent) {
    evento.preventDefault();
    if (pendiente || !texto.trim()) return;
    setFallo(null); setError(""); setMensaje("");
    iniciar(async () => {
      try {
        const resultado = await agregarNotaAccion(clienteId, { tipo, texto, ...(corrigeA ? { corrigeA } : {}) });
        if (!resultado.ok) { setFallo(resultado); return; }
        setTexto(""); setCorrigeA(undefined); setMensaje("Nota guardada."); router.refresh();
      } catch { setError("No recibimos confirmación. Conservamos tu nota; recarga la ficha para comprobar si se guardó antes de reintentar."); }
    });
  }
  return <section aria-label="Notas de seguimiento" className="space-y-5 rounded-xl border bg-background p-5 sm:p-6">
    <h2 className="text-lg font-semibold">Notas de seguimiento</h2>
    <p id={`${id}-aviso`} className="text-sm text-muted-foreground">No escribas datos sensibles</p>
    {notas.length === 0 ? <p className="text-sm">Sin notas de seguimiento.</p> : <ol className="space-y-4">{notas.map((nota) => <li key={nota.id} className="space-y-2 border-l-2 pl-4">
      <p className="text-xs text-muted-foreground">{nota.tipo} · {nota.autor} · {new Date(nota.en).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}{nota.corregida ? " · corregida" : ""}</p>
      <p className="whitespace-pre-wrap break-words text-sm">{nota.texto}</p>
      {puedeAnotar && <Button type="button" variant="ghost" disabled={pendiente} aria-label={`Corregir nota de ${nota.autor}`} onClick={() => { setCorrigeA(nota.id); setTipo(nota.tipo); setTexto(nota.texto); setMensaje(""); campo.current?.focus(); }}>Corregir nota</Button>}
    </li>)}</ol>}
    {puedeAnotar && <form onSubmit={guardar} className="space-y-4">
      <fieldset disabled={pendiente} className="space-y-4">
        <label className="block space-y-2 text-sm">Tipo de nota<select className={CLASE_SELECT} value={tipo} onChange={(e) => setTipo(e.target.value as TipoNota)}><option value="llamada">Llamada</option><option value="queja">Queja</option><option value="acuerdo">Acuerdo</option><option value="otro">Otro</option></select></label>
        {corrigeA && <p className="text-sm">Corrigiendo una nota. La anterior se conserva en el registro.</p>}
        <label className="block space-y-2 text-sm">Texto de la nota<Textarea ref={campo} value={texto} required maxLength={1000} aria-describedby={`${id}-aviso`} onChange={(e) => setTexto(e.target.value)} /></label>
        <p className="text-xs text-muted-foreground">{texto.length}/1000 caracteres</p>
        <div className="flex gap-2"><Button type="submit" disabled={!texto.trim()}>{pendiente ? "Guardando…" : corrigeA ? "Guardar corrección" : "Agregar nota"}</Button>{corrigeA && <Button type="button" variant="outline" onClick={() => { setCorrigeA(undefined); setTexto(""); }}>Cancelar corrección</Button>}</div>
      </fieldset>
    </form>}
    {fallo && <ResultadoFallido resultado={fallo} />}{error && <p role="alert" className="text-sm">{error}</p>}{mensaje && <p role="status" className="text-sm">{mensaje}</p>}
  </section>;
}
