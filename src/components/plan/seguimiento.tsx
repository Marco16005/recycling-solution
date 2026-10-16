"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { VistaSeguimiento } from "@/consultas/operacion.nucleo";
import type { VistaPlan } from "@/consultas/plan";
import type { Resultado } from "@/acciones/tipos";
import { conciliarEventoAccion, generarReruteoAccion, resolverIncidenteAccion } from "@/acciones/operacion";
import { ResultadoFallido, type Fallo } from "@/components/clientes/resultado-fallido";
import { Button } from "@/components/ui/button";

export function Seguimiento({ vista, plan }: { vista: VistaSeguimiento; plan: VistaPlan }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [fallo, setFallo] = useState<Fallo | null>(null);
  const [incierto, setIncierto] = useState(false);
  const [retiradas, setRetiradas] = useState<string[]>([]);
  useEffect(() => { const id = setInterval(() => router.refresh(), 30_000); return () => clearInterval(id); }, [router]);
  function ejecutar<T>(accion: () => Promise<Resultado<T>>, despues?: (valor: T) => void) {
    setFallo(null); setIncierto(false);
    iniciar(async () => {
      try { const r = await accion(); if (!r.ok) setFallo(r); else { despues?.(r.valor); router.refresh(); } }
      catch { setIncierto(true); }
    });
  }
  return <section aria-label="Seguimiento de operación" className="space-y-5 border-t pt-6">
    <h2 className="text-2xl font-semibold">Seguimiento</h2>
    <p className="text-sm text-muted-foreground">Se actualiza cada 30 segundos.</p>
    {fallo && (fallo.error === "conflicto" ? <p role="alert">{fallo.motivo?.texto ?? "El plan cambió; consulta el estado actual."}</p> : <ResultadoFallido resultado={fallo} />)}
    {incierto && <p role="alert">No se pudo confirmar la operación. Actualiza el estado antes de reintentar.</p>}
    <div className="grid gap-3 sm:grid-cols-2">{vista.porJornada.map(j => <article key={j.jornadaId} className="rounded-xl border p-4">
      <h3 className="font-semibold">{j.placa} · {j.operador}</h3>
      <p>{j.checkOut ? "Jornada terminada" : j.checkIn ? "En jornada" : "Sin llegar al patio"}</p>
      <p>{j.avance.completadas} completadas · {j.avance.noAtendidas} no atendidas · {j.avance.pendientes} pendientes · {j.avance.enSitio} en sitio</p>
      {j.ultimoEvento && <p className="text-sm">Último evento: {j.ultimoEvento.tipo.replaceAll("_", " ")} · {new Date(j.ultimoEvento.en).toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City" })}</p>}
    </article>)}</div>
    <fieldset disabled={pendiente || incierto} className="space-y-5">
      <section aria-label="Incidentes abiertos" className="space-y-3"><h3 className="text-xl font-semibold">Incidentes abiertos</h3>
        {!vista.incidentesAbiertos.length && <p>Sin incidentes abiertos.</p>}
        {vista.incidentesAbiertos.map(i => <article key={i.id} className="space-y-3 rounded-xl border p-4">
          <h4 className="font-semibold">{vista.porJornada.find(j => j.jornadaId === i.jornadaId)?.placa} · {i.tipo.replaceAll("_", " ")}</h4><p>{i.descripcion}</p>
          {vista.puedeResolver && <form aria-label={`Resolver ${i.descripcion}`} className="flex flex-wrap gap-3" onSubmit={e => {
            e.preventDefault(); const accion = String(new FormData(e.currentTarget).get("accion"));
            ejecutar(() => resolverIncidenteAccion(i.id, i.version, { accion }));
          }}><label>Acción<select name="accion" className="ml-2 rounded border bg-background p-2"><option value="continuar">Continuar</option>{i.paradaId && <option value="cancelar">Cancelar solicitud pendiente</option>}<option value="re_ruteo">Re-ruteo</option></select></label><Button type="submit">Resolver incidente</Button></form>}
        </article>)}
      </section>
      <section aria-label="Eventos rechazados" className="space-y-3"><h3 className="text-xl font-semibold">Eventos rechazados</h3>
        {!vista.eventosRechazados.length && <p>Sin eventos por conciliar.</p>}
        {vista.eventosRechazados.map(e => <article key={e.eventoId} className="space-y-3 rounded-xl border p-4"><p>{vista.porJornada.find(j => j.jornadaId === e.jornadaId)?.placa} · {e.tipo.replaceAll("_", " ")}</p><p>{e.motivoRechazo}</p>
          {vista.puedeConciliar && <form aria-label={`Conciliar ${e.eventoId}`} onSubmit={f => {
            f.preventDefault(); const nota = String(new FormData(f.currentTarget).get("nota")).trim(); ejecutar(() => conciliarEventoAccion(e.eventoId, { nota }));
          }}><label>Nota de conciliación<textarea name="nota" required maxLength={300} className="mb-3 block w-full rounded border bg-background p-3" /></label><Button type="submit">Conciliar</Button></form>}
        </article>)}
      </section>
      {plan.puedeGenerar && <section aria-label="Re-rutear" className="space-y-3 rounded-xl border p-4"><h3 className="text-xl font-semibold">Re-rutear</h3>
        {plan.reruteoPropuesto ? <Link className="underline" href={`/despacho/plan?fecha=${plan.fecha}&plan=${plan.reruteoPropuesto.planId}`}>Revisar re-ruteo propuesto</Link> : <>
          <p>Marca las jornadas que dejan de estar disponibles. Los viajes en curso de las demás unidades quedan congelados.</p>
          {vista.porJornada.map(j => <label key={j.jornadaId} className="flex items-center gap-3"><input type="checkbox" checked={retiradas.includes(j.jornadaId)} onChange={e => setRetiradas(ids => e.target.checked ? [...ids, j.jornadaId] : ids.filter(id => id !== j.jornadaId))} />No disponible: {j.placa}</label>)}
          <Button onClick={() => ejecutar(() => generarReruteoAccion(plan.planId!, plan.version!, { jornadasNoDisponibles: retiradas }), r => router.push(`/despacho/plan?fecha=${plan.fecha}&plan=${r.planId}`))}>Generar re-ruteo</Button>
        </>}
      </section>}
    </fieldset>
    {incierto && <Button variant="outline" onClick={() => { setIncierto(false); router.refresh(); }}>Consultar estado actual</Button>}
  </section>;
}
