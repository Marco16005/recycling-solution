"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { VistaMiRuta } from "@/consultas/operador.nucleo";
import type { EventoEntrada } from "@/dominio/operacion/tipos";
import { proyectarEvento, siguienteAccion, type AccionOperador } from "@/dominio/operacion/siguiente-accion";
import { registrarEventoAccion, reportarIncidenteAccion } from "@/acciones/operador";
import { Button } from "@/components/ui/button";

type Incidente = { eventoId: string; jornadaId: string; tipo: string; descripcion: string; paradaId?: string };
type Pendiente = { clase: "evento"; entrada: EventoEntrada } | { clase: "incidente"; entrada: Incidente };
export interface Guardado { vista: VistaMiRuta; cola: Pendiente[]; rechazados: { eventoId: string; motivo: string }[] }
/** getRandomValues también está disponible en el origen HTTP del e2e; UUID v4. */
function nuevoId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const h = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const campo = "block w-full rounded-lg border bg-background p-3 text-base";

export function MiRuta({ usuarioId, inicial }: { usuarioId: string; inicial: VistaMiRuta }) {
  const router = useRouter();
  const [datos, setDatos] = useState<Guardado>({ vista: inicial, cola: [], rechazados: [] });
  const actual = useRef(datos);
  const [otras, setOtras] = useState<{ pendientes: number; rechazados: Guardado["rechazados"] }>({ pendientes: 0, rechazados: [] });
  const [listo, setListo] = useState(false);
  const [conectado, setConectado] = useState(true);
  const [mensaje, setMensaje] = useState("");
  const [confirmar, setConfirmar] = useState<AccionOperador | null>(null);
  const [incidente, setIncidente] = useState(false);
  const ocupado = useRef(false);
  const prefijo = `rs-operador:${usuarioId}:`;
  const clave = (vista: VistaMiRuta) => `${prefijo}${vista.jornadaId}`;

  useEffect(() => {
    let cancelado = false;
    const publicar = (valor: Guardado) => {
      if (cancelado) return;
      actual.current = valor; setDatos(valor);
    };
    function actualizarOtras() {
      if (cancelado) return;
      let pendientes = 0;
      const rechazados: Guardado["rechazados"] = [];
      for (const llave of Object.keys(localStorage)) {
        if (!llave.startsWith(prefijo) || llave === clave(actual.current.vista)) continue;
        const lote: Guardado = JSON.parse(localStorage.getItem(llave)!);
        pendientes += lote.cola.length;
        rechazados.push(...lote.rechazados.map(r => ({ ...r, motivo: `${lote.vista.fecha}: ${r.motivo}` })));
      }
      setOtras({ pendientes, rechazados });
    }
    queueMicrotask(() => {
      if (cancelado) return;
      try {
        const guardado = inicial.jornadaId ? localStorage.getItem(clave(inicial)) : null;
        const anterior: Guardado | null = guardado ? JSON.parse(guardado) : null;
        const valor = anterior ? { ...anterior, vista: navigator.onLine ? inicial : anterior.vista }
          : { vista: inicial, cola: [], rechazados: [] };
        publicar(valor);
        if (valor.vista.jornadaId) localStorage.setItem(clave(valor.vista), JSON.stringify(valor));
        actualizarOtras();
        setListo(true);
      } catch { setMensaje("No se puede guardar la ruta en este teléfono. Libera espacio antes de registrar eventos."); }
      setConectado(navigator.onLine);
      void enviar();
    });

    async function enviar() {
      setConectado(navigator.onLine);
      if (!navigator.onLine || ocupado.current) return;
      ocupado.current = true;
      try {
        // Incluye jornadas anteriores: una nueva jornada nunca oculta sus eventos sin enviar.
        const llaves = Object.keys(localStorage).filter(k => k.startsWith(prefijo)).sort((a, b) => {
          const primero: Guardado = JSON.parse(localStorage.getItem(a)!);
          const segundo: Guardado = JSON.parse(localStorage.getItem(b)!);
          return primero.vista.fecha.localeCompare(segundo.vista.fecha);
        });
        for (const llave of llaves) {
          let lote: Guardado = JSON.parse(localStorage.getItem(llave)!);
          while (lote.cola.length && navigator.onLine && !cancelado) {
            const primero = lote.cola[0];
            const respuesta = primero.clase === "evento"
              ? await registrarEventoAccion(primero.entrada) : await reportarIncidenteAccion(primero.entrada);
            // Releer: el operador puede haber agregado eventos durante la petición.
            lote = JSON.parse(localStorage.getItem(llave)!);
            if (!respuesta.ok) {
              setMensaje(respuesta.error === "conflicto" ? respuesta.motivo?.texto ?? "Conflicto: llama al despachador."
                : respuesta.error === "invalido" ? Object.values(respuesta.campos).flat().join(". ")
                : "No se pudo autorizar el envío. Conservamos la cola; llama al despachador.");
              return;
            }
            if ("estado" in respuesta.valor) {
              lote.vista.estado = respuesta.valor.estado;
              if (respuesta.valor.resultado === "rechazado" && !lote.rechazados.some(r => r.eventoId === primero.entrada.eventoId))
                lote.rechazados.push({ eventoId: primero.entrada.eventoId, motivo: respuesta.valor.motivo ?? "Evento rechazado" });
            }
            lote.cola = lote.cola.filter(e => e.entrada.eventoId !== primero.entrada.eventoId);
            localStorage.setItem(llave, JSON.stringify(lote));
            if (llave === clave(actual.current.vista)) publicar(lote);
            actualizarOtras();
          }
        }
        if (!cancelado) router.refresh();
      } catch { if (!cancelado) setMensaje("Envío pendiente. Reintentaremos con el mismo identificador al recuperar la señal."); }
      finally { ocupado.current = false; }
    }
    const sinConexion = () => setConectado(false);
    const guardarAntesDeSalir = (e: BeforeUnloadEvent) => {
      const pendientes = Object.keys(localStorage).filter(k => k.startsWith(prefijo))
        .some(k => (JSON.parse(localStorage.getItem(k)!) as Guardado).cola.length > 0);
      if (pendientes) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("online", enviar);
    window.addEventListener("rs-operador-enviar", enviar);
    window.addEventListener("offline", sinConexion);
    window.addEventListener("beforeunload", guardarAntesDeSalir);
    const intervalo = window.setInterval(enviar, 30_000);
    return () => {
      cancelado = true; clearInterval(intervalo);
      window.removeEventListener("online", enviar); window.removeEventListener("offline", sinConexion);
      window.removeEventListener("rs-operador-enviar", enviar);
      window.removeEventListener("beforeunload", guardarAntesDeSalir);
    };
    // La vista del servidor cambia con cada refresh; no debe reiniciar un envío en curso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuarioId, inicial.jornadaId]);

  useEffect(() => {
    if (!listo || !navigator.onLine || actual.current.cola.length || ocupado.current) return;
    let cancelado = false;
    queueMicrotask(() => {
      if (cancelado || actual.current.cola.length || ocupado.current) return;
      const valor = { ...actual.current, vista: inicial };
      try {
        if (inicial.jornadaId) localStorage.setItem(clave(inicial), JSON.stringify(valor));
        actual.current = valor; setDatos(valor);
      } catch { setMensaje("No se pudo actualizar la ruta guardada."); }
    });
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inicial]);

  function encolar(pendiente: Pendiente) {
    const valor = { ...actual.current, cola: [...actual.current.cola, pendiente] };
    try {
      localStorage.setItem(clave(valor.vista), JSON.stringify(valor));
      actual.current = valor; setDatos(valor); setMensaje("");
      window.dispatchEvent(new Event("rs-operador-enviar"));
      return true;
    } catch { setMensaje("No se guardó el evento. Libera espacio y vuelve a intentarlo antes de continuar."); return false; }
  }
  const estado = datos.cola.reduce((e, p) => e && p.clase === "evento" ? proyectarEvento(e, p.entrada) : e, datos.vista.estado);
  const accion = estado ? siguienteAccion(estado) : null;
  function registrar(a: AccionOperador, odometroKm: number | null = null, motivo: string | null = null) {
    if (!estado || !listo) return;
    if (a.tipo === "no_atendida" && !motivo?.trim()) { setMensaje("Escribe el motivo antes de confirmar."); return; }
    const evento: EventoEntrada = { eventoId: nuevoId(), jornadaId: estado.jornadaId,
      ocurridoEn: new Date().toISOString(), tipo: a.tipo, rutaId: a.rutaId, paradaId: a.paradaId,
      versionRuta: a.versionRuta, odometroKm, motivo };
    if (encolar({ clase: "evento", entrada: evento })) setConfirmar(null);
  }
  function pulsar(a: AccionOperador) {
    if (["salida_patio", "regreso_patio", "no_atendida"].includes(a.tipo)) setConfirmar(a);
    else registrar(a);
  }
  return <main className="space-y-5">
    <div><p className="text-sm text-muted-foreground">{datos.vista.fecha} · {datos.vista.unidad?.placa ?? "Sin unidad"}</p>
      <h1 className="text-3xl font-semibold">Mi ruta</h1></div>
    <p role="status" className="rounded-lg border p-3">{conectado ? "Con conexión" : "Sin conexión"} · {datos.cola.length + otras.pendientes} eventos por enviar</p>
    {mensaje && <p role="alert">{mensaje}</p>}
    {!estado && <p>No tienes una ruta asignada para hoy.</p>}
    {estado?.checkOutEn && <p className="rounded-lg bg-muted p-5 font-semibold">Jornada terminada</p>}
    {accion && <section className="space-y-3" aria-label="Siguiente acción">
      <Button className="min-h-16 w-full touch-manipulation select-none text-lg" disabled={!listo || !!confirmar} onClick={() => pulsar(accion)}>{accion.texto}</Button>
      {accion.permiteNoAtendida && <Button className="min-h-12 w-full" variant="outline" disabled={!listo || !!confirmar} onClick={() => pulsar({ ...accion, tipo: "no_atendida", texto: "No se pudo atender" })}>No se pudo atender</Button>}
    </section>}
    {confirmar && <form aria-label="Confirmar evento" className="space-y-3 rounded-xl border p-4" onSubmit={e => {
      e.preventDefault(); const valores = new FormData(e.currentTarget);
      registrar(confirmar, confirmar.tipo === "no_atendida" ? null : Number(valores.get("odometro")), confirmar.tipo === "no_atendida" ? String(valores.get("motivo")).trim() : null);
    }}><h2 className="font-semibold">{confirmar.texto}</h2>
      {confirmar.tipo === "no_atendida" ? <label>Motivo<textarea className={campo} name="motivo" required maxLength={200} /></label>
        : <label>Odómetro (km)<input className={campo} name="odometro" type="number" inputMode="decimal" step="any" max={9999999} min={estado?.ultimoOdometroKm ?? 0} required /></label>}
      <div className="flex gap-3"><Button type="submit">Confirmar</Button><Button type="button" variant="outline" onClick={() => setConfirmar(null)}>Volver</Button></div>
    </form>}
    {datos.rechazados.length + otras.rechazados.length > 0 && <section aria-label="Eventos rechazados" className="space-y-3 rounded-xl border border-destructive p-4"><h2 className="font-semibold">Llama al despachador</h2>
      {[...datos.rechazados, ...otras.rechazados].map(r => <p key={r.eventoId}>{r.motivo}</p>)}</section>}
    {datos.vista.viajes.map(v => <section key={v.rutaId} aria-label={`Viaje ${v.numero}`} className="space-y-3">
      <h2 className="text-xl font-semibold">Viaje {v.numero}</h2><p className="text-sm">Salida {v.salidaEstimada} · Regreso {v.regresoEstimado}</p>
      {v.paradas.map(p => <article key={p.paradaId} aria-label={`Parada ${p.folio}`} className="space-y-2 rounded-xl border p-4">
        <h3 className="font-semibold">{p.secuencia}. {p.cliente.nombre}</h3><p className="text-sm">{p.folio} · {estado?.viajes.flatMap(v => v.paradas).find(e => e.paradaId === p.paradaId)?.estado.replaceAll("_", " ") ?? p.estado}</p>
        <p>{p.cliente.direccion ?? "Sin dirección"}</p><p>{p.cliente.notasAcceso ?? "Sin notas de acceso"}</p>
        <p className="text-sm">Ventana {p.ventana.inicio}–{p.ventana.fin} · Llegada {p.llegadaEstimada} · {p.cargaKg} kg</p>
        {p.cliente.lat !== null && p.cliente.lng !== null && <a className="inline-block min-h-12 py-3 font-medium underline" href={`geo:${p.cliente.lat},${p.cliente.lng}`}>Abrir mapa</a>}
      </article>)}
    </section>)}
    {estado && <Button variant="outline" className="min-h-12 w-full" onClick={() => setIncidente(!incidente)}>Reportar incidente</Button>}
    {incidente && estado && <form aria-label="Reportar incidente" className="space-y-3 rounded-xl border p-4" onSubmit={e => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      const entrada: Incidente = { eventoId: nuevoId(), jornadaId: estado.jornadaId, tipo: String(f.get("tipo")), descripcion: String(f.get("descripcion")).trim() };
      if (!entrada.descripcion) { setMensaje("Describe brevemente el incidente."); return; }
      if (f.get("parada")) entrada.paradaId = String(f.get("parada"));
      if (encolar({ clase: "incidente", entrada })) setIncidente(false);
    }}>
      <label>Tipo<select name="tipo" className={campo}>{[["averia", "Avería"], ["retraso", "Retraso"], ["cierre_vial", "Cierre vial"], ["cliente_no_disponible", "Cliente no disponible"], ["otro", "Otro"]].map(([valor, texto]) => <option key={valor} value={valor}>{texto}</option>)}</select></label>
      <label>Descripción<textarea name="descripcion" required maxLength={300} className={campo} /></label>
      <label>Parada (opcional)<select name="parada" className={campo}><option value="">Toda la jornada</option>{datos.vista.viajes.flatMap(v => v.paradas).map(p => <option key={p.paradaId} value={p.paradaId}>{p.folio}</option>)}</select></label>
      <Button type="submit" disabled={!listo}>Enviar incidente</Button>
    </form>}
  </main>;
}
