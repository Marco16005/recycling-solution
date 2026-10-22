"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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

const motivos = {
  sin_unidades_disponibles: "No hay unidades disponibles.",
  sin_unidad_compatible: "No hay una unidad disponible del tipo admitido por el cliente.",
  sin_cupo: "No hay una posición factible con la capacidad, ventanas y turnos actuales.",
  // Plan 8 (P8-0): el texto con el Δ real llega en P8-5.
  alarga_la_jornada: "Cabría, pero alarga la jornada más que la tolerancia.",
  pospuesta_a_mano: "Pospuesta por el despachador.",
  carga_mayor_a_capacidad_compatible: "La carga supera la capacidad de todas las unidades compatibles.",
};
const numero = (n: number) => n.toLocaleString("es-MX", { maximumFractionDigits: 1 });
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

export function PlanDelDia({ vista }: { vista: VistaPlan }) {
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
    <ContenidoPlan key={`${vista.fecha}-${vista.planId}-${vista.version}-${vista.estado}`} vista={vista} />
  </section>;
}

function ContenidoPlan({ vista }: { vista: VistaPlan }) {
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
  return <>
    <header className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-3xl font-semibold tracking-tight">Plan del día</h1>
          <p className="mt-2 text-sm">{vista.fecha} · <strong>{({ sin_plan: "Sin plan", propuesto: "Propuesto", validado: "Validado" })[vista.estado]}</strong></p>
          {(vista.estado === "validado" || !vista.puedeGenerar) && <p className="mt-2 text-sm text-muted-foreground">Solo lectura</p>}
        </div>
        {vista.puedeGenerar && vista.estado !== "validado" && vista.tipo !== "re_ruteo" && <Button disabled={ocupado || incierto} onClick={() => ejecutar(() => generarPlanAccion(vista.fecha))}>
          {vista.estado === "sin_plan" && codigo !== "generacion_adelantada" && codigo !== "datos_cambiaron" ? "Generar plan" : "Regenerar"}
        </Button>}
      </div>
      {vista.tipo === "re_ruteo" && <p className="rounded-lg border p-3">Propuesta de re-ruteo · {vista.congeladas.length} solicitudes congeladas conservadas en sus rutas originales, sin ajustes. <Link className="underline" href={`/despacho/plan?fecha=${vista.fecha}`}>Volver al plan vigente</Link></p>}
      <SelectorFecha fecha={vista.fecha} ruta="/despacho/plan" />
      {vista.generadoEn && <p className="text-sm text-muted-foreground">Generado: {instante(vista.generadoEn)} · Ajustes: {vista.ajustes}</p>}
      {vista.estado !== "sin_plan" && <p className="w-fit rounded-lg border bg-muted px-3 py-2 text-sm font-medium">{textoTiempos(vista.traslados)}</p>}
      <p className="text-sm text-muted-foreground">{vista.ultimaEjecucion
        ? `Última ejecución del motor: ${instante(vista.ultimaEjecucion.en)} · ${{ ok: "Correcta", error: "Error", tiempo_agotado: "Tiempo agotado" }[vista.ultimaEjecucion.resultado]} · ${numero(vista.ultimaEjecucion.duracionMs)} ms`
        : "Sin ejecuciones del motor para esta fecha."}</p>
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
    {resumen && <section aria-label="Resumen del plan" className="space-y-4">
      <h2 className="text-xl font-semibold">Resumen</h2>
      <dl className="grid gap-3 sm:grid-cols-3">{([
        ["Ruteadas", resumen.ruteadas], ["Pospuestas", resumen.pospuestas], ["Bloqueadas", resumen.bloqueadas],
      ] as const).map(([titulo, valor]) => <div key={titulo} className="rounded-xl border p-4"><dt className="text-sm text-muted-foreground">{titulo}</dt><dd className="mt-2 font-mono text-3xl">{valor}</dd></div>)}</dl>
      <div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm">
        <caption className="p-4 text-left font-semibold">Comparativo simulado · mismas solicitudes ruteadas</caption>
        <thead><tr><th scope="col" className="p-3">Método</th><th scope="col" className="p-3">Kilómetros</th><th scope="col" className="p-3">Traslado (min)</th></tr></thead>
        <tbody><tr><th scope="row" className="p-3">Plan propuesto</th><td className="p-3">{numero(resumen.km)}</td><td className="p-3">{numero(resumen.minutosTraslado)}</td></tr>
          <tr><th scope="row" className="p-3">Un viaje por cliente</th><td className="p-3">{numero(resumen.kmMetodoActual)}</td><td className="p-3">{numero(resumen.minutosTrasladoMetodoActual)}</td></tr></tbody>
      </table></div>
      <p className="text-xs text-muted-foreground">Estimaciones de distancia y tiempo; no son resultados de recorridos reales.</p>
    </section>}
    {vista.pinesARevisar.length > 0 && <section aria-label="Pins por revisar" className="space-y-3 rounded-xl border p-4">
      <h2 className="text-xl font-semibold">Pins por revisar</h2>
      <ul className="list-inside list-disc space-y-2 text-sm">{vista.pinesARevisar.map(p => <li key={p.clienteId}>
        <Link className="underline" href={`/despacho/clientes/${p.clienteId}`}>{p.nombre}</Link>: revisa el pin, a {numero(p.distanciaM)} m de la calle.
      </li>)}</ul>
    </section>}
    {vista.estado !== "sin_plan" && <MapaPlan vista={vista} />}
    <fieldset disabled={bloqueado} className="min-w-0 space-y-6" aria-label="Detalle y ajustes del plan">
      {vista.unidades.map(u => <section key={u.jornadaId} aria-label={`Unidad ${u.unidad.placa}`} className="space-y-4 rounded-xl border bg-background p-5">
        <div><h2 className="text-xl font-semibold">{u.unidad.placa}</h2><p className="text-sm text-muted-foreground">Operador: {u.operador.nombre}</p></div>
        {u.viajes.length === 0 && <p className="text-sm">Sin viajes asignados.</p>}
        {u.viajes.map(v => <section key={v.numero} aria-label={`Viaje ${v.numero}`} className="space-y-3">
          <h3 className="font-semibold">Viaje {v.numero}</h3>
          <p className="text-sm">Salida {v.salida} · Regreso {v.regreso} · Fin de descarga {v.finDescarga}</p>
          <p className="text-sm">Carga {numero(v.cargaKg)} / {numero(v.capacidadKg)} kg · {numero(v.km)} km</p>
          <ol className="space-y-3">{v.paradas.map(p => <li key={p.solicitudId}>
            <article aria-label={`Parada ${p.folio}`} className="space-y-4 rounded-lg border p-4">
              <div><h4 className="font-mono font-semibold">{p.folio}</h4><p className="break-words">{p.secuencia}. {p.cliente.nombre}</p></div>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{([
                ["Ventana", `${p.ventana.inicio}–${p.ventana.fin}`], ["Llegada", p.llegada], ["Espera", `${p.esperaMin} min`],
                ["Inicio", p.inicio], ["Fin", p.fin], ["Carga", `${numero(p.cargaKg)} kg`], ["Desde anterior", `${numero(p.kmDesdeAnterior)} km`],
              ] as const).map(([titulo, valor]) => <div key={titulo}><dt className="text-muted-foreground">{titulo}</dt><dd className="tabular-nums">{valor}</dd></div>)}</dl>
              {vista.congeladas.includes(p.solicitudId) && <p>Congelada · sin ajustes</p>}
              {editable && !vista.congeladas.includes(p.solicitudId) && <><MoverSolicitud solicitudId={p.solicitudId} folio={p.folio} unidades={vista.unidades} mover={ajustar} />
                <Button variant="ghost" onClick={() => ajustar({ tipo: "posponer", solicitudId: p.solicitudId })}>Posponer</Button></>}
            </article>
          </li>)}</ol>
        </section>)}
      </section>)}
      <section aria-label="Solicitudes pospuestas" className="space-y-3">
        <h2 className="text-xl font-semibold">Pospuestas</h2>
        <p className="text-sm text-muted-foreground">Al validar, pasarán al siguiente día de operación conservando su registro original.</p>
        {vista.pospuestas.length === 0 && <p className="text-sm">Sin solicitudes pospuestas.</p>}
        {vista.pospuestas.map(p => <article key={p.solicitudId} aria-label={`Pospuesta ${p.folio}`} className="space-y-3 rounded-xl border p-4">
          <h3 className="font-mono font-semibold">{p.folio}</h3><p>{p.cliente}</p><p className="text-sm">{motivos[p.motivo]}</p>
          {p.diagnostico && <p className="text-sm text-muted-foreground">Posiciones rechazadas: capacidad {p.diagnostico.capacidad}; ventana {p.diagnostico.ventana}; fin de turno {p.diagnostico.finDeTurno}; afecta a otra parada {p.diagnostico.afectaAOtra}.</p>}
          {editable && !vista.congeladas.includes(p.solicitudId) && <MoverSolicitud solicitudId={p.solicitudId} folio={p.folio} unidades={vista.unidades} mover={ajustar} />}
        </article>)}
      </section>
      <section aria-label="Solicitudes bloqueadas" className="space-y-3">
        <h2 className="text-xl font-semibold">Bloqueadas</h2>
        {vista.bloqueadas.length === 0 && <p className="text-sm">Sin solicitudes bloqueadas por el motor.</p>}
        {vista.bloqueadas.map(p => <article key={p.solicitudId} className="space-y-2 rounded-xl border p-4"><h3 className="font-mono font-semibold">{p.folio}</h3><p>{p.cliente}</p><p>{motivos[p.motivo]}</p></article>)}
      </section>
      {vista.estado !== "sin_plan" && <section aria-label="Requisitos de acceso" className="space-y-4">
        <h2 className="text-xl font-semibold">Requisitos de acceso por operador</h2>
        {vista.requisitos.length === 0 && <p className="text-sm">No hay requisitos de acceso por confirmar.</p>}
        {vista.requisitos.map(r => <div key={r.jornadaId} className="space-y-3 rounded-xl border p-4">
          <h3 className="font-semibold">{r.operador}</h3>
          <ul className="list-inside list-disc text-sm">{r.clientes.map((c, i) => <li key={i}>{c.nombre}: {c.tipos.join(", ")}</li>)}</ul>
          {editable && vista.puedeValidar && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={confirmados.includes(r.jornadaId)} onChange={e => {
            setConfirmados(actual => e.target.checked ? [...actual, r.jornadaId] : actual.filter(id => id !== r.jornadaId));
          }} />Confirmo los requisitos de {r.operador}</label>}
        </div>)}
        {vista.estado === "validado" && <p className="text-sm">Requisitos confirmados al validar el plan.</p>}
      </section>}
      {editable && <div className="flex flex-wrap gap-3 border-t pt-5">
        {vista.puedeValidar && <Button disabled={!requisitosConfirmados} onClick={() => ejecutar(() => validarPlanAccion(vista.planId!, vista.version!, { requisitosConfirmados }))}>Validar</Button>}
        <Button variant="outline" onClick={() => ejecutar(async () => {
          const resultado = await descartarPlanAccion(vista.planId!, vista.version!);
          if (resultado.ok && vista.tipo === "re_ruteo") router.replace(`/despacho/plan?fecha=${vista.fecha}`);
          return resultado;
        })}>Descartar</Button>
      </div>}
    </fieldset>
  </>;
}
