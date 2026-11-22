"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SeguimientoJornada, VistaSeguimiento } from "@/consultas/operacion.nucleo";
import type { VistaPlan } from "@/consultas/plan";
import type { Resultado } from "@/acciones/tipos";
import type { EventoEntrada } from "@/dominio/operacion/tipos";
import { instanteDeMinutos } from "@/dominio/plan/entrada";
import { fechaEnMexico } from "@/dominio/tiempo";
import { conciliarEventoAccion, generarReruteoAccion, registrarEventoPorDespachoAccion, resolverIncidenteAccion } from "@/acciones/operacion";
import { ResultadoFallido, type Fallo } from "@/components/clientes/resultado-fallido";
import { Button } from "@/components/ui/button";

const nombresAlerta = { ventana_en_riesgo: "En riesgo", fuera_de_turno: "Fuera de turno", atraso: "Atraso" };
const relojMexico = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const horaActualMexico = () => relojMexico.format(new Date());

/** Conserva el desfase de Ciudad de México para la fecha elegida, incluso si cambia estacionalmente. */
function horaConDesfase(fecha: string, hora: string): string {
  const [h, m] = hora.split(":").map(Number);
  const instante = instanteDeMinutos(fecha, h * 60 + m);
  const desfaseMin = (Date.parse(`${fecha}T${hora}:00Z`) - instante.getTime()) / 60_000;
  const signo = desfaseMin < 0 ? "-" : "+";
  const absoluto = Math.abs(desfaseMin);
  return `${fecha}T${hora}:00${signo}${String(Math.floor(absoluto / 60)).padStart(2, "0")}:${String(absoluto % 60).padStart(2, "0")}`;
}

function colorEstado(estado: string): string {
  if (["terminado", "recolectada"].includes(estado)) return "border-emerald-600/30 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300";
  if (["en_camino", "en_cliente", "recolectando", "descargando"].includes(estado)) return "border-sky-600/30 bg-sky-600/10 text-sky-800 dark:text-sky-300";
  if (estado === "no_atendida") return "border-amber-600/30 bg-amber-600/10 text-amber-800 dark:text-amber-300";
  return "border-border bg-muted text-muted-foreground";
}

function MarcaDespacho({ jornada, fecha }: { jornada: SeguimientoJornada; fecha: string }) {
  const router = useRouter();
  const paso = jornada.tablero.siguiente!;
  const [modo, setModo] = useState<"normal" | "no_atendida" | null>(null);
  const [hora, setHora] = useState(horaActualMexico);
  const [odometro, setOdometro] = useState("");
  const [motivo, setMotivo] = useState("");
  const [entradaPendiente, setEntradaPendiente] = useState<EventoEntrada | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [incierto, setIncierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aplicado, setAplicado] = useState(false);

  function abrir(siguienteModo: "normal" | "no_atendida") {
    setModo(siguienteModo); setHora(horaActualMexico()); setOdometro(""); setMotivo("");
    setEntradaPendiente(null); setIncierto(false); setError(null);
  }

  async function enviar(entrada: EventoEntrada) {
    setEnviando(true); setError(null); setIncierto(false);
    try {
      const resultado = await registrarEventoPorDespachoAccion(entrada);
      if (!resultado.ok) {
        setEntradaPendiente(null);
        setError(resultado.error === "invalido"
          ? Object.values(resultado.campos).flat().join(" ")
          : resultado.error === "conflicto" ? resultado.motivo?.texto ?? "El estado cambió; consulta el tablero."
            : "No se pudo guardar la marca. Consulta el tablero.");
        router.refresh();
      } else if (resultado.valor.resultado === "rechazado") {
        setEntradaPendiente(null);
        setError(resultado.valor.motivo ?? "La marca fue rechazada; consulta el tablero.");
        router.refresh();
      } else {
        setEntradaPendiente(null); setAplicado(true); setModo(null); router.refresh();
      }
    } catch {
      // La respuesta puede perderse después de guardar: el mismo id hace seguro el reintento.
      setEntradaPendiente(entrada); setIncierto(true);
    } finally { setEnviando(false); }
  }

  function confirmar() {
    const ahora = new Date();
    const hoy = fechaEnMexico(ahora);
    if (!/^\d{2}:\d{2}$/.test(hora) || (paso.desde && hora < paso.desde) || (fecha === hoy && hora > relojMexico.format(ahora))) {
      setError("Elige una hora del día que no sea anterior a la última marca ni futura."); return;
    }
    if (modo === "no_atendida" && (!motivo.trim() || motivo.length > 200)) {
      setError("Escribe un motivo de hasta 200 caracteres."); return;
    }
    const km = odometro.trim() === "" ? null : Number(odometro);
    if (km !== null && (!Number.isFinite(km) || km < 0 || km > 9_999_999)) { setError("El odómetro debe estar entre 0 y 9 999 999 km."); return; }
    try {
      // La hora actual conserva sus segundos para no quedar antes de una marca del mismo minuto.
      const ocurridoEn = fecha === hoy && hora === relojMexico.format(ahora)
        ? ahora.toISOString() : horaConDesfase(fecha, hora);
      const entrada: EventoEntrada = { eventoId: crypto.randomUUID(), jornadaId: jornada.jornadaId,
        tipo: modo === "no_atendida" ? "no_atendida" : paso.tipo, ocurridoEn,
        rutaId: paso.rutaId, paradaId: paso.paradaId, versionRuta: paso.versionRuta,
        odometroKm: modo === "normal" && paso.pideOdometro ? km : null,
        motivo: modo === "no_atendida" ? motivo.trim() : null };
      setEntradaPendiente(entrada);
      void enviar(entrada);
    } catch { setError("Esa hora no existe en Ciudad de México para la fecha del plan."); }
  }

  return <div className="mt-5 border-t pt-4">
    {!aplicado && <div className="flex flex-wrap gap-2">
      {/* Parte la línea: con nombres largos de cliente, un botón sin saltos desborda la pantalla del teléfono. */}
      <Button type="button" className="h-auto min-h-9 whitespace-normal py-2 text-left" disabled={enviando || incierto} onClick={() => abrir("normal")}>Marcar: {paso.texto}</Button>
      {paso.permiteNoAtendida && <Button type="button" variant="outline" disabled={enviando || incierto} onClick={() => abrir("no_atendida")}>No se pudo atender</Button>}
    </div>}
    {modo && !aplicado && <form aria-label={`Marcar avance de ${jornada.placa}`} className="mt-4 space-y-3 rounded-lg border bg-background p-4" onSubmit={e => { e.preventDefault(); confirmar(); }}>
      <p className="font-medium">{modo === "no_atendida" ? "No se pudo atender" : paso.texto}</p>
      <label className="block text-sm">Hora en Ciudad de México
        <input type="time" name="hora" required min={paso.desde ?? undefined} max={fecha === fechaEnMexico(new Date()) ? horaActualMexico() : undefined} disabled={incierto || enviando}
          value={hora} onChange={e => { setHora(e.target.value); setEntradaPendiente(null); setIncierto(false); }} className="mt-1 block rounded border bg-background px-3 py-2" />
      </label>
      {modo === "normal" && paso.pideOdometro && <label className="block text-sm">Odómetro (km, opcional)
        <input type="number" min="0" max="9999999" step="any" value={odometro} disabled={incierto || enviando} onChange={e => { setOdometro(e.target.value); setEntradaPendiente(null); }} className="mt-1 block w-40 rounded border bg-background px-3 py-2" />
      </label>}
      {modo === "no_atendida" && <label className="block text-sm">Motivo
        <textarea required maxLength={200} value={motivo} disabled={incierto || enviando} onChange={e => { setMotivo(e.target.value); setEntradaPendiente(null); }} className="mt-1 block w-full rounded border bg-background px-3 py-2" />
      </label>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={enviando || incierto}>Confirmar marca</Button>
        <Button type="button" variant="outline" disabled={enviando || incierto} onClick={() => { setModo(null); setEntradaPendiente(null); setError(null); }}>Cancelar</Button>
      </div>
    </form>}
    {incierto && entradaPendiente && <div role="alert" className="mt-3 space-y-2 text-sm">
      <p>No se pudo confirmar la marca. Puedes reintentar el mismo envío sin duplicarlo.</p>
      <Button type="button" variant="outline" disabled={enviando} onClick={() => void enviar(entradaPendiente)}>Reintentar envío</Button>
    </div>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
  </div>;
}

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
    <p className="text-sm text-muted-foreground">Cada camión avanza cuando su operador marca en el teléfono o cuando lo marcas aquí. Se actualiza cada 30 segundos.</p>
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
    <div className="grid gap-4 xl:grid-cols-2">{vista.porJornada.map(j => <article key={j.jornadaId} aria-label={`Camión ${j.placa}`} className="min-w-0 rounded-xl border bg-card p-5 shadow-sm">
      <h3 className="text-lg font-semibold">{j.placa} · {j.operador}</h3>
      <p className="mt-3 text-2xl font-semibold leading-tight">{j.tablero.frase}</p>
      <p className="mt-2 text-sm font-medium tabular-nums text-muted-foreground">{j.tablero.recolecciones.hechas} de {j.tablero.recolecciones.total} recolecciones</p>
      {j.proyeccion.aproximada && <p className="mt-2 text-sm text-muted-foreground">Proyección aproximada</p>}
      <div className="mt-5 space-y-4">{j.tablero.viajes.map(v => <section key={v.rutaId} className="rounded-lg border bg-background p-4">
        <h4 className="flex flex-wrap items-center gap-2 font-semibold">Viaje {v.numero} · <span className={`rounded-full border px-2 py-0.5 text-sm ${colorEstado(v.estado)}`}>{v.etiqueta}</span></h4>
        <p className="mt-1 text-sm tabular-nums text-muted-foreground">Salió {v.salida ?? "—"} · Regresó {v.regreso ?? "—"}</p>
        <ul aria-label={`Recolecciones del viaje ${v.numero}`} className="mt-3 divide-y">{v.paradas.map(p => <li key={p.paradaId} className="py-3 text-sm first:pt-0 last:pb-0">
          <p className="break-words font-medium">{p.folio} · {p.cliente}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2 py-0.5 ${colorEstado(p.estado)}`}>{p.etiqueta}</span><span className="tabular-nums">{p.horaPlan
            ? `Llegada proyectada ${p.hora ?? "—"} · Llegada estimada ${p.horaPlan}` : p.hora ?? "Sin hora"} · Ventana {p.ventana.inicio}–{p.ventana.fin}</span></p>
          {p.motivo && <p className="mt-1 break-words text-amber-800 dark:text-amber-300">Motivo: {p.motivo}</p>}
        </li>)}</ul>
      </section>)}</div>
      {vista.puedeRegistrar && j.tablero.siguiente && <MarcaDespacho key={`${j.jornadaId}-${j.tablero.siguiente.tipo}-${j.ultimoEvento?.en ?? ""}`} jornada={j} fecha={plan.fecha} />}
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
