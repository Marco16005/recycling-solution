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

const nombresAlerta = { ventana_en_riesgo: "En riesgo", fuera_de_turno: "Fuera de turno", atraso: "Atraso" };

export function Seguimiento({ vista, plan }: { vista: VistaSeguimiento; plan: VistaPlan }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [fallo, setFallo] = useState<Fallo | null>(null);
  const [incierto, setIncierto] = useState(false);
  const [retiradas, setRetiradas] = useState<string[]>([]);
  const [liberadas, setLiberadas] = useState<string[]>([]);
  // El sondeo puede cambiar la elegibilidad mientras se prepara el re-ruteo.
  const liberables = new Set(vista.porJornada.filter(j => !j.checkOut && !retiradas.includes(j.jornadaId))
    .flatMap(j => j.proyeccion.paradas.filter(p => p.liberable && !p.enViajeEnCurso).map(p => p.solicitudId)));
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
    <section aria-label="Alertas" className="space-y-3 rounded-xl border p-4">
      <h3 className="text-xl font-semibold">Alertas</h3>
      <p>{vista.resumenAlertas.ventana_en_riesgo} paradas en riesgo · {vista.resumenAlertas.fuera_de_turno} fuera de turno · {vista.resumenAlertas.atraso} con atraso</p>
      <ul className="space-y-2 text-sm">{vista.porJornada.flatMap(j => j.proyeccion.alertas.map(a => {
        const parada = j.proyeccion.paradas.find(p => p.paradaId === a.paradaId);
        return <li key={`${j.jornadaId}-${a.rutaId}-${a.paradaId}-${a.tipo}`} className="rounded-lg border p-3">
          <strong>{nombresAlerta[a.tipo]}</strong> · {j.placa}{parada && ` · ${parada.folio} · ${parada.cliente}`} · {a.minutos} min · {a.enViajeEnCurso ? "viaje en curso" : "viaje futuro"}
        </li>;
      }))}</ul>
    </section>
    {fallo && (fallo.error === "conflicto" ? <p role="alert">{fallo.motivo?.texto ?? "El plan cambió; consulta el estado actual."}</p> : <ResultadoFallido resultado={fallo} />)}
    {incierto && <p role="alert">No se pudo confirmar la operación. Actualiza el estado antes de reintentar.</p>}
    <div className="grid gap-3 sm:grid-cols-2">{vista.porJornada.map(j => <article key={j.jornadaId} className="rounded-xl border p-4">
      <h3 className="font-semibold">{j.placa} · {j.operador}</h3>
      <p>{j.checkOut ? "Jornada terminada" : j.checkIn ? "En jornada" : "Sin llegar al patio"}</p>
      <p>{j.avance.completadas} completadas · {j.avance.noAtendidas} no atendidas · {j.avance.pendientes} pendientes · {j.avance.enSitio} en sitio</p>
      {j.ultimoEvento && <p className="text-sm">Último evento: {j.ultimoEvento.tipo.replaceAll("_", " ")} · {new Date(j.ultimoEvento.en).toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City" })}</p>}
      {j.proyeccion.aproximada && <p className="mt-3 text-sm text-muted-foreground">proyección aproximada</p>}
      <ul className="mt-3 space-y-3 text-sm">{j.proyeccion.paradas.map(p => <li key={p.paradaId} className="space-y-1 border-t pt-3">
        <p className="break-words font-medium">{p.folio} · {p.cliente}</p>
        <p>{p.enViajeEnCurso ? "viaje en curso" : "viaje futuro"} · Ventana {p.ventana.inicio}–{p.ventana.fin}</p>
        <p className="tabular-nums">Llegada estimada {p.llegadaEstimada} · Llegada proyectada {p.llegadaProyectada}</p>
        {p.ubicacionSupuesta && <p className="text-muted-foreground">ubicación supuesta</p>}
      </li>)}</ul>
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
          <p className="text-sm text-muted-foreground">Liberar permite volver a asignar una parada de un viaje futuro; puede quedar en la misma unidad.</p>
          {vista.porJornada.map(j => <div key={j.jornadaId} className="space-y-2 rounded-lg border p-3">
            <label className="flex min-h-12 items-center gap-3"><input type="checkbox" checked={retiradas.includes(j.jornadaId)} onChange={e => {
              const retirada = e.target.checked;
              setRetiradas(ids => retirada ? [...ids, j.jornadaId] : ids.filter(id => id !== j.jornadaId));
              if (retirada) {
                const solicitudes = new Set(j.proyeccion.paradas.map(p => p.solicitudId));
                setLiberadas(ids => ids.filter(id => !solicitudes.has(id)));
              }
            }} />No disponible: {j.placa}</label>
            {j.proyeccion.paradas.filter(p => !p.enViajeEnCurso).map(p => <div key={p.paradaId} className="pl-4">
              <label className="flex min-h-12 items-center gap-3"><input type="checkbox"
                disabled={!liberables.has(p.solicitudId)}
                checked={liberables.has(p.solicitudId) && liberadas.includes(p.solicitudId)}
                onChange={e => {
                  const marcada = e.target.checked;
                  setLiberadas(ids => marcada ? [...ids.filter(id => liberables.has(id)), p.solicitudId] : ids.filter(id => id !== p.solicitudId));
                }} />Liberar {p.folio}</label>
              <p className="break-words text-sm text-muted-foreground">{p.cliente}</p>
            </div>)}
          </div>)}
          <Button onClick={() => {
            const entrada = { jornadasNoDisponibles: retiradas, liberadas: liberadas.filter(id => liberables.has(id)) };
            ejecutar(() => generarReruteoAccion(plan.planId!, plan.version!, entrada), r => router.push(`/despacho/plan?fecha=${plan.fecha}&plan=${r.planId}`));
          }}>Generar re-ruteo</Button>
        </>}
      </section>}
    </fieldset>
    {incierto && <Button variant="outline" onClick={() => { setIncierto(false); router.refresh(); }}>Consultar estado actual</Button>}
  </section>;
}
