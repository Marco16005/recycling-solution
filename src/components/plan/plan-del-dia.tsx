"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { VistaPlan } from "@/consultas/plan";
import type { Resultado } from "@/acciones/tipos";
import { ajustarPlanAccion, descartarPlanAccion, generarPlanAccion, iniciarRevisionAccion, validarPlanAccion } from "@/acciones/plan";
import { ResultadoFallido, type Fallo } from "@/components/clientes/resultado-fallido";
import { SelectorFecha } from "@/components/flota/selector-fecha";
import { Button } from "@/components/ui/button";
import { MapaPlan } from "./mapa-plan";
import { MoverSolicitud, type Movimiento } from "./mover-solicitud";
import { PasosPlan } from "./pasos-plan";

const motivos = {
  sin_unidades_disponibles: "No hay unidades disponibles.",
  sin_unidad_compatible: "No hay una unidad disponible del tipo admitido por el cliente.",
  sin_cupo: "No hay una posición factible con la capacidad, ventanas y turnos actuales.",
  alarga_la_jornada: "Cabría, pero alarga la jornada",
  pospuesta_a_mano: "Pospuesta por el despachador.",
  carga_mayor_a_capacidad_compatible: "La carga supera la capacidad de todas las unidades compatibles.",
};
const numero = (n: number) => n.toLocaleString("es-MX", { maximumFractionDigits: 1 });
const diferencia = (n: number, decimales = 0) => `${n < 0 ? "−" : "+"}${Math.abs(n).toLocaleString("es-MX", { minimumFractionDigits: decimales, maximumFractionDigits: decimales })}`;

function ReacomodoDelPlan({ reacomodo }: { reacomodo: NonNullable<VistaPlan["reacomodo"]> }) {
  const { antes, despues, readmitidas, alargaLaJornada, ajustesManualesDespues } = reacomodo;
  const metricas = [
    ["ruteadas", "Ruteadas"],
    ["pospuestas", "Pospuestas"],
    ["tiempoMuertoMin", "Tiempo muerto (min)"],
    ["km", "Kilómetros"],
    ["minutosTraslado", "Minutos de traslado (sin horas pico)"],
  ] as const;
  const sinMejoras = metricas.every(([campo]) => antes[campo] === despues[campo]);
  return <section aria-label="Reacomodo" className="space-y-4">
    <h2 className="text-xl font-semibold">{ajustesManualesDespues > 0
      ? `Reacomodo automático (antes de ${ajustesManualesDespues} ajustes manuales)`
      : "Reacomodo automático"}</h2>
    <p className="rounded-lg border bg-muted px-3 py-2 text-sm font-medium">{sinMejoras ? "Sin mejoras"
      : `Reacomodo: ${diferencia(despues.ruteadas - antes.ruteadas)} paradas atendidas · tiempo muerto ${diferencia(despues.tiempoMuertoMin - antes.tiempoMuertoMin)} min · ${diferencia(despues.km - antes.km, 1)} km`}</p>
    <div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm">
      <caption className="p-4 text-left font-semibold">Antes y después del reacomodo automático</caption>
      <thead><tr><th scope="col" className="p-3">Métrica</th><th scope="col" className="p-3">Antes</th><th scope="col" className="p-3">Después</th></tr></thead>
      <tbody>{metricas.map(([campo, titulo]) => <tr key={campo}>
        <th scope="row" className="p-3">{titulo}{campo === "tiempoMuertoMin" && <span className="block text-xs font-normal text-muted-foreground">con horas pico, incluye espera y descargas</span>}</th>
        <td className="p-3 tabular-nums">{numero(antes[campo])}</td><td className="p-3 tabular-nums">{numero(despues[campo])}</td>
      </tr>)}</tbody>
    </table></div>
    <p className="text-sm">Readmitidas: {readmitidas}{alargaLaJornada > 0 && ` · ${alargaLaJornada} pospuestas alargarían la jornada`}</p>
  </section>;
}

const motivosAproximados = {
  sin_configurar: "mapa de calles sin configurar",
  sin_respuesta: "el servicio de mapas no respondió",
  respuesta_invalida: "el servicio de mapas devolvió una respuesta no válida",
  error_osrm: "el servicio de mapas no pudo calcular los recorridos",
  demasiados_puntos: "se superó el límite de puntos del mapa",
};
function textoTiempos(traslados: VistaPlan["traslados"]) {
  if (!traslados) return "Tiempos aproximados: plan anterior a los tiempos por calle";
  if (traslados.fuente === "aproximado") return `Tiempos aproximados: ${traslados.motivo ? motivosAproximados[traslados.motivo] : "sin información del motivo"}`;
  if (traslados.paresAproximados > 0) return `Tiempos por calle; ${traslados.paresAproximados} pares aproximados`;
  return `Tiempos por calle (mapa ${traslados.mapa ?? "sin identificador"})`;
}
const instante = (fecha: Date) => new Date(fecha).toLocaleString("es-MX", {
  timeZone: "America/Mexico_City", dateStyle: "medium", timeStyle: "short",
});

/** antesDeGenerar: la lista "Antes de generar" (diseño del 2026-11-21), debajo del encabezado. */
export function PlanDelDia({ vista, antesDeGenerar, seguimiento, recoleccionesConservadasEnCurso }: { vista: VistaPlan; antesDeGenerar?: ReactNode; seguimiento?: ReactNode; recoleccionesConservadasEnCurso: number }) {
  const revisiones = useRef(new Set<string>());
  const [errorRevision, setErrorRevision] = useState<{ id: string; texto: string } | null>(null);
  useEffect(() => {
    const id = vista.planId;
    if (!id || vista.estado !== "propuesto" || !vista.puedeGenerar || vista.revisionIniciada || revisiones.current.has(id)) return;
    revisiones.current.add(id);
    void iniciarRevisionAccion(id).then(resultado => {
      if (!resultado.ok) setErrorRevision({ id, texto: "No se pudo registrar el inicio de revisión. Vuelve a abrir el plan." });
    }).catch(() => setErrorRevision({ id, texto: "No se pudo confirmar el inicio de revisión. Vuelve a abrir el plan." }));
  }, [vista.planId, vista.estado, vista.puedeGenerar, vista.revisionIniciada]);
  return <section aria-label="Plan del día" className="space-y-6">
    {errorRevision?.id === vista.planId && <p role="alert">{errorRevision?.texto}</p>}
    <ContenidoPlan key={`${vista.fecha}-${vista.planId}-${vista.version}-${vista.estado}`} vista={vista} antesDeGenerar={antesDeGenerar} seguimiento={seguimiento} recoleccionesConservadasEnCurso={recoleccionesConservadasEnCurso} />
  </section>;
}

function ContenidoPlan({ vista, antesDeGenerar, seguimiento, recoleccionesConservadasEnCurso }: { vista: VistaPlan; antesDeGenerar?: ReactNode; seguimiento?: ReactNode; recoleccionesConservadasEnCurso: number }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [fallo, setFallo] = useState<Fallo | null>(null);
  const [incierto, setIncierto] = useState(false);
  const [terminado, setTerminado] = useState(false);
  const [confirmados, setConfirmados] = useState<string[]>([]);
  const errorRef = useRef<HTMLDivElement>(null);
  const editable = vista.estado === "propuesto" && vista.puedeGenerar;
  const ocupado = pendiente || terminado;
  const conflicto = fallo?.error === "conflicto";
  const codigo = conflicto ? fallo.motivo?.codigo : undefined;
  const recuperable = codigo === "hora_vencida" || codigo === "datos_cambiaron" || codigo === "generacion_adelantada";
  const bloqueado = ocupado || incierto || conflicto;
  const requisitosConfirmados = vista.requisitos.every(r => confirmados.includes(r.jornadaId));
  useEffect(() => {
    if (!pendiente && (fallo || incierto)) errorRef.current?.focus();
  }, [fallo, incierto, pendiente]);

  function ejecutar<T>(accion: () => Promise<Resultado<T>>) {
    if (ocupado || incierto) return;
    setFallo(null);
    iniciar(async () => {
      try {
        const resultado = await accion();
        if (!resultado.ok) { setFallo(resultado); return; }
        // No reenviar la versión anterior mientras llega la vista revalidada.
        setTerminado(true);
        router.refresh();
      } catch { setIncierto(true); }
    });
  }
  function ajustar(ajuste: Movimiento | { tipo: "posponer"; solicitudId: string } | { tipo: "actualizarHora" }) {
    if (!vista.planId || vista.version === null) return;
    ejecutar(() => ajustarPlanAccion(vista.planId!, vista.version!, ajuste));
  }
  const resumen = vista.resumen;
  const detallesTecnicos = <details className="min-w-0 rounded-xl border p-4">
    <summary className="cursor-pointer font-semibold">Detalles técnicos</summary>
    <div className="mt-3 space-y-2 text-sm text-muted-foreground">
      {vista.generadoEn && <p>Generado: {instante(vista.generadoEn)} · Ajustes: {vista.ajustes}</p>}
      {vista.estado !== "sin_plan" && <p>{textoTiempos(vista.traslados)}</p>}
      <p>{vista.ultimaEjecucion
        ? `Última ejecución del motor: ${instante(vista.ultimaEjecucion.en)} · ${{ ok: "Correcta", error: "Error", tiempo_agotado: "Tiempo agotado" }[vista.ultimaEjecucion.resultado]} · ${numero(vista.ultimaEjecucion.duracionMs)} ms`
        : "Sin ejecuciones del motor para esta fecha."}</p>
    </div>
  </details>;
  const tarjetas = resumen && <section aria-label="Resumen del plan" className="space-y-3">
    <h2 className="text-xl font-semibold">Resumen</h2>
    <dl className="grid min-w-0 gap-3 sm:grid-cols-3">{([
      ["En ruta", resumen.ruteadas, ""], ["Pospuestas", resumen.pospuestas, "pasan al siguiente día"],
      ["Bloqueadas", resumen.bloqueadas, "no se pueden planear"],
    ] as const).map(([titulo, valor, nota]) => <div key={titulo} className="min-w-0 rounded-xl border p-4">
      <dt className="text-sm font-medium">{titulo}</dt><dd className="mt-1 font-mono text-3xl">{valor}</dd>
      {nota && <p className="mt-1 text-xs text-muted-foreground">{nota}</p>}
    </div>)}</dl>
  </section>;
  const comparativo = resumen && <div className="space-y-2">
    <div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm">
      <caption className="p-4 text-left font-semibold">Comparativo simulado · mismas solicitudes ruteadas</caption>
      <thead><tr><th scope="col" className="p-3">Método</th><th scope="col" className="p-3">Kilómetros</th><th scope="col" className="p-3">Traslado (min)</th></tr></thead>
      <tbody><tr><th scope="row" className="p-3">Plan propuesto</th><td className="p-3">{numero(resumen.km)}</td><td className="p-3">{numero(resumen.minutosTraslado)}</td></tr>
        <tr><th scope="row" className="p-3">Un viaje por cliente</th><td className="p-3">{numero(resumen.kmMetodoActual)}</td><td className="p-3">{numero(resumen.minutosTrasladoMetodoActual)}</td></tr></tbody>
    </table></div>
    <p className="text-xs text-muted-foreground">Estimaciones de distancia y tiempo; no son resultados de recorridos reales.</p>
  </div>;
  const analisis = <div className="space-y-5">{comparativo}
    {vista.reacomodo !== null && <ReacomodoDelPlan reacomodo={vista.reacomodo} />}
    {detallesTecnicos}
  </div>;
  const pines = vista.pinesARevisar.length > 0 && <section aria-label="Pins por revisar" className="space-y-3 rounded-xl border p-4">
    <h2 className="text-xl font-semibold">Pins por revisar</h2>
    <ul className="list-inside list-disc space-y-2 text-sm">{vista.pinesARevisar.map(p => <li key={p.clienteId} className="[overflow-wrap:anywhere]">
      <Link className="underline" href={`/despacho/clientes/${p.clienteId}`}>{p.nombre}</Link>: revisa el pin, a {numero(p.distanciaM)} m de la calle.
    </li>)}</ul>
  </section>;
  const rutas = <div className="min-w-0 space-y-5">
    {vista.estado !== "sin_plan" && <MapaPlan vista={vista} />}
    {pines}
    <fieldset disabled={bloqueado} className="min-w-0 space-y-5" aria-label="Detalle y ajustes del plan">
      {vista.unidades.map(u => <section key={u.jornadaId} aria-label={`Unidad ${u.unidad.placa}`} className="min-w-0 space-y-4 rounded-xl border bg-background p-4 sm:p-5">
        <div><h2 className="text-xl font-semibold">{u.unidad.placa}</h2><p className="text-sm text-muted-foreground">Operador: {u.operador.nombre}</p></div>
        {u.viajes.length === 0 && <p className="text-sm">Sin viajes asignados.</p>}
        {u.viajes.map(v => <section key={v.numero} aria-label={`Viaje ${v.numero}`} className="min-w-0 space-y-3">
          <h3 className="font-semibold">Viaje {v.numero}</h3>
          <p className="text-sm">Salida {v.salida} · Regreso {v.regreso} · Fin de descarga {v.finDescarga}</p>
          <p className="text-sm">Carga {numero(v.cargaKg)} / {numero(v.capacidadKg)} kg · {numero(v.km)} km</p>
          <ol className="space-y-3">{v.paradas.map(p => <li key={p.solicitudId} className="min-w-0">
            <article aria-label={`Parada ${p.folio}`} className="min-w-0 space-y-2 rounded-lg border p-3 sm:p-4">
              <h4 className="min-w-0 font-medium [overflow-wrap:anywhere]">{p.secuencia}. {p.cliente.nombre} · llega {p.llegada} · horario {p.ventana.inicio}–{p.ventana.fin} · {numero(p.cargaKg)} kg</h4>
              <p className="font-mono text-xs text-muted-foreground">{p.folio}</p>
              <p className="text-xs text-muted-foreground">Espera {p.esperaMin} min · termina {p.fin} · {numero(p.kmDesdeAnterior)} km desde la anterior</p>
              <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Más horas de esta parada</summary>
                <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1"><div><dt>Inicio</dt><dd>{p.inicio}</dd></div><div><dt>Fin</dt><dd>{p.fin}</dd></div></dl>
              </details>
              {vista.congeladas.includes(p.solicitudId) && <p>Congelada · sin ajustes</p>}
              {editable && !vista.congeladas.includes(p.solicitudId) && <details className="rounded-lg border p-3">
                <summary className="cursor-pointer font-medium">Mover o posponer</summary>
                <div className="mt-3 space-y-2"><MoverSolicitud solicitudId={p.solicitudId} folio={p.folio} unidades={vista.unidades} mover={ajustar} />
                  <Button variant="ghost" onClick={() => ajustar({ tipo: "posponer", solicitudId: p.solicitudId })}>Posponer</Button></div>
              </details>}
            </article>
          </li>)}</ol>
        </section>)}
      </section>)}
    </fieldset>
  </div>;
  const pendientes = (vista.pospuestas.length > 0 || vista.bloqueadas.length > 0) && <fieldset disabled={bloqueado} className="min-w-0 space-y-5">
    {vista.pospuestas.length > 0 && <section aria-label="Solicitudes pospuestas" className="space-y-3">
      <h2 className="text-xl font-semibold">Pospuestas</h2>
      <p className="text-sm text-muted-foreground">Al validar, pasarán al siguiente día de operación conservando su registro original.</p>
      {vista.pospuestas.map(p => <article key={p.solicitudId} aria-label={`Pospuesta ${p.folio}`} className="min-w-0 space-y-3 rounded-xl border p-4">
        <h3 className="font-mono font-semibold">{p.folio}</h3><p className="[overflow-wrap:anywhere]">{p.cliente}</p>
        <p className="text-sm">{motivos[p.motivo]}{p.motivo === "alarga_la_jornada" && p.diagnostico?.deltaMinimoMin !== undefined && ` ${p.diagnostico.deltaMinimoMin} min`}</p>
        {p.diagnostico && <p className="text-sm text-muted-foreground">Posiciones rechazadas: capacidad {p.diagnostico.capacidad}; horario del cliente {p.diagnostico.ventana}; fin de turno {p.diagnostico.finDeTurno}; afecta a otra parada {p.diagnostico.afectaAOtra}.</p>}
        {editable && !vista.congeladas.includes(p.solicitudId) && <MoverSolicitud solicitudId={p.solicitudId} folio={p.folio} unidades={vista.unidades} mover={ajustar} />}
      </article>)}
    </section>}
    {vista.bloqueadas.length > 0 && <section aria-label="Solicitudes bloqueadas" className="space-y-3">
      <h2 className="text-xl font-semibold">Bloqueadas</h2>
      {vista.bloqueadas.map(p => <article key={p.solicitudId} className="min-w-0 space-y-2 rounded-xl border p-4"><h3 className="font-mono font-semibold">{p.folio}</h3><p className="[overflow-wrap:anywhere]">{p.cliente}</p><p>{motivos[p.motivo]}</p></article>)}
    </section>}
  </fieldset>;
  const requisitos = vista.estado !== "sin_plan" && <section aria-label="Requisitos de acceso" className="space-y-4">
    <h2 className="text-xl font-semibold">Requisitos de acceso por operador</h2>
    {vista.requisitos.length === 0 && <p className="text-sm">No hay requisitos de acceso por confirmar.</p>}
    {vista.requisitos.map(r => <div key={r.jornadaId} className="space-y-3 rounded-xl border p-4">
      <h3 className="font-semibold [overflow-wrap:anywhere]">{r.operador}</h3>
      <ul className="list-inside list-disc text-sm">{r.clientes.map((c, i) => <li key={i} className="[overflow-wrap:anywhere]">{c.nombre}: {c.tipos.join(", ")}</li>)}</ul>
      {editable && vista.puedeValidar && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" disabled={bloqueado} checked={confirmados.includes(r.jornadaId)} onChange={e => {
        setConfirmados(actual => e.target.checked ? [...actual, r.jornadaId] : actual.filter(id => id !== r.jornadaId));
      }} />Confirmo los requisitos de {r.operador}</label>}
    </div>)}
    {vista.estado === "validado" && <p className="text-sm">Requisitos confirmados al validar el plan.</p>}
  </section>;
  return <>
    <header className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-3xl font-semibold tracking-tight">Plan del día</h1>
          <p className="mt-2 text-sm">{vista.fecha} · <strong>{({ sin_plan: "Sin plan", propuesto: "Propuesto", validado: "Validado" })[vista.estado]}</strong></p>
        </div>
        {vista.puedeGenerar && vista.estado !== "validado" && vista.tipo !== "re_ruteo" && <Button disabled={ocupado || incierto} onClick={() => ejecutar(() => generarPlanAccion(vista.fecha))}>
          {vista.estado === "sin_plan" && codigo !== "generacion_adelantada" && codigo !== "datos_cambiaron" ? "Generar plan" : "Regenerar"}
        </Button>}
      </div>
      <PasosPlan vista={vista} />
      {vista.tipo === "re_ruteo" && <p className="rounded-lg border p-3">{vista.estado === "validado" ? <>
        Este plan es un re-ruteo validado: reemplazó al plan anterior.{recoleccionesConservadasEnCurso > 0 && ` ${recoleccionesConservadasEnCurso} ${recoleccionesConservadasEnCurso === 1 ? "recolección de viajes en curso se conservó" : "recolecciones de viajes en curso se conservaron"} sin cambios.`}
      </> : <>
        Propuesta de re-ruteo · {vista.congeladas.length} {vista.congeladas.length === 1 ? "solicitud congelada conservada" : "solicitudes congeladas conservadas"} en sus rutas originales, sin ajustes. <Link className="underline" href={`/despacho/plan?fecha=${vista.fecha}`}>Volver al plan vigente</Link>
      </>}</p>}
      <SelectorFecha fecha={vista.fecha} ruta="/despacho/plan" />
      {vista.nuevasDesdeGeneracion > 0 && <p role="status" className="rounded-lg border p-4">
        Hay {vista.nuevasDesdeGeneracion} solicitudes nuevas listas desde la generación. {vista.puedeGenerar ? "Regenera para incluirlas." : "El despachador puede regenerar para incluirlas."}
      </p>}
    </header>
    {(fallo || incierto) && <div ref={errorRef} tabIndex={-1} role="alert" className="space-y-3 rounded-lg border border-destructive/40 p-4 text-sm">
      {incierto ? <p>No se pudo confirmar la operación. Consulta el estado antes de volver a enviarla.</p>
        : fallo?.error === "conflicto" ? <p>{fallo.motivo?.texto ?? "La versión del plan cambió. Consulta el estado actual antes de continuar."}</p>
        : fallo?.error === "invalido" ? <ul className="list-inside list-disc">{Object.entries(fallo.campos).flatMap(([campo, mensajes]) => mensajes.map((m, i) => <li key={`${campo}-${i}`}>{m}</li>))}</ul>
        : fallo && <ResultadoFallido resultado={fallo} />}
      {codigo === "hora_vencida" && editable && <Button disabled={ocupado} onClick={() => ajustar({ tipo: "actualizarHora" })}>Actualizar horarios</Button>}
      {(incierto || (conflicto && !recuperable)) && <Button variant="outline" onClick={() => window.location.reload()}>Consultar estado actual</Button>}
    </div>}
    {ocupado && <p role="status">{pendiente ? "Procesando plan…" : "Actualizando plan…"}</p>}
    {vista.estado === "sin_plan" && <>{antesDeGenerar}{detallesTecnicos}</>}
    {vista.estado === "propuesto" && <>
      {antesDeGenerar}{tarjetas}{rutas}{pendientes}
      <section aria-label="Último paso: validar" className="space-y-5 rounded-xl border p-4 sm:p-5">
        <h2 className="text-xl font-semibold">Último paso: validar</h2>
        {requisitos}
        {editable && <fieldset disabled={bloqueado} className="space-y-3">
          {vista.puedeValidar && !requisitosConfirmados && <p className="text-sm">Para validar, confirma los requisitos de cada operador</p>}
          <div className="flex flex-wrap gap-3">
            {vista.puedeValidar && <Button disabled={!requisitosConfirmados} onClick={() => ejecutar(() => validarPlanAccion(vista.planId!, vista.version!, { requisitosConfirmados }))}>Validar</Button>}
            <Button variant="outline" onClick={() => ejecutar(async () => {
              const resultado = await descartarPlanAccion(vista.planId!, vista.version!);
              if (resultado.ok && vista.tipo === "re_ruteo") router.replace(`/despacho/plan?fecha=${vista.fecha}`);
              return resultado;
            })}>Descartar</Button>
          </div>
        </fieldset>}
      </section>
      <details className="min-w-0 rounded-xl border p-4"><summary className="cursor-pointer font-semibold">Comparativo y reacomodo (para análisis)</summary>
        <div className="mt-5">{analisis}</div>
      </details>
    </>}
    {vista.estado === "validado" && <>
      {seguimiento}
      <details className="min-w-0 rounded-xl border p-4"><summary className="cursor-pointer font-semibold">Ver el plan validado: rutas, mapa y resumen</summary>
        <div className="mt-5 space-y-6">{rutas}{pendientes}{requisitos}{tarjetas}{comparativo}
          {vista.reacomodo !== null && <ReacomodoDelPlan reacomodo={vista.reacomodo} />}
          {detallesTecnicos}
        </div>
      </details>
    </>}
  </>;
}
