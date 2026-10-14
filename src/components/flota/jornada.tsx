"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { asignarJornadaAccion, quitarJornadaAccion } from "@/acciones/jornada";
import type { FilaJornada, VistaJornada } from "@/consultas/jornada";
import { Campo, CLASE_SELECT } from "@/components/clientes/campos-formulario";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EstadoFlota } from "./estado-flota";
import { MensajesOperacion, useOperacion } from "./operacion";

function QuitarJornada({ jornada }: { jornada: FilaJornada }) {
  const router = useRouter();
  const op = useOperacion();
  const [confirmar, setConfirmar] = useState(false);
  const [terminada, setTerminada] = useState(false);
  return (
    <form
      className="space-y-3" aria-label={`Quitar jornada de ${jornada.unidad.placa}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (terminada) return;
        if (!confirmar) { setConfirmar(true); return; }
        op.ejecutar(() => quitarJornadaAccion(jornada.id, jornada.version), () => {
          op.setMensaje("Jornada retirada. Actualizando…");
          setTerminada(true);
          router.refresh();
        });
      }}
    >
      <MensajesOperacion operacion={op} alRevisar={() => setConfirmar(false)} />
      {confirmar && <p className="text-sm">Se liberarán la unidad y el operador de esta jornada.</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="outline" disabled={op.pendiente || op.conflicto || terminada}>
          {op.pendiente ? "Quitando…" : confirmar ? "Confirmar quitar" : "Quitar"}
        </Button>
        {confirmar && <Button type="button" variant="ghost" onClick={() => setConfirmar(false)}>Volver</Button>}
      </div>
    </form>
  );
}

export function Jornada({ vista }: { vista: VistaJornada }) {
  const router = useRouter();
  const prefijo = useId();
  const op = useOperacion();
  const [unidadId, setUnidadId] = useState("");
  const [operadorId, setOperadorId] = useState("");
  const [hora, setHora] = useState("08:00");
  const [notas, setNotas] = useState("");

  function asignar(e: FormEvent) {
    e.preventDefault();
    if (!vista.puedeGestionar) return;
    const errores: Record<string, string[]> = {};
    if (!vista.unidadesLibres.some((u) => u.id === unidadId)) errores.unidadId = ["Selecciona una unidad libre"];
    if (!vista.operadoresLibres.some((o) => o.id === operadorId)) errores.operadorId = ["Selecciona un operador libre"];
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) errores.disponibleDesde = ["Indica una hora válida"];
    if (Object.keys(errores).length) { op.setErrores(errores); return; }
    op.ejecutar(() => asignarJornadaAccion({
      fecha: vista.fecha, unidadId, operadorId, disponibleDesde: hora, notas: notas || null,
    }), () => {
      setUnidadId("");
      setOperadorId("");
      setNotas("");
      op.setMensaje("Jornada asignada.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {vista.puedeGestionar ? (
        <form onSubmit={asignar} noValidate className="space-y-5 rounded-xl border bg-background p-5">
          <h2 className="text-lg font-semibold">Asignar salida · {vista.fecha}</h2>
          <MensajesOperacion
            operacion={op} alRevisar={() => {
              setUnidadId("");
              setOperadorId("");
              op.setMensaje("Selecciona de nuevo entre las unidades y operadores libres.");
            }}
          />
          <fieldset disabled={op.pendiente || op.conflicto} className="grid gap-4 sm:grid-cols-2">
            <Campo nombre="unidadId" titulo="Unidad libre" prefijo={prefijo} errores={op.errores}>
              {(a) => (
                <select {...a} className={CLASE_SELECT} value={unidadId} onChange={(e) => setUnidadId(e.target.value)}>
                  <option value="">Selecciona una unidad</option>
                  {vista.unidadesLibres.map((u) => (
                    <option key={u.id} value={u.id}>{u.placa} · {u.capacidadKg.toLocaleString("es-MX")} kg</option>
                  ))}
                </select>
              )}
            </Campo>
            <Campo nombre="operadorId" titulo="Operador libre" prefijo={prefijo} errores={op.errores}>
              {(a) => (
                <select
                  {...a} className={CLASE_SELECT} value={operadorId} onChange={(e) => setOperadorId(e.target.value)}
                >
                  <option value="">Selecciona un operador</option>
                  {vista.operadoresLibres.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                </select>
              )}
            </Campo>
            <Campo nombre="disponibleDesde" titulo="Disponible desde" prefijo={prefijo} errores={op.errores}>
              {(a) => <Input {...a} type="time" value={hora} onChange={(e) => setHora(e.target.value)} />}
            </Campo>
            <Campo nombre="notas" titulo="Notas (opcional)" prefijo={prefijo} errores={op.errores}>
              {(a) => <Textarea {...a} value={notas} onChange={(e) => setNotas(e.target.value)} />}
            </Campo>
          </fieldset>
          {(!vista.unidadesLibres.length || !vista.operadoresLibres.length) && (
            <p className="text-sm">
              No hay suficientes unidades y operadores libres. Revisa las asignaciones y motivos.
            </p>
          )}
          <Button
            type="submit" disabled={op.pendiente || op.conflicto ||
              !vista.unidadesLibres.length || !vista.operadoresLibres.length}
          >
            {op.pendiente ? "Asignando…" : "Asignar jornada"}
          </Button>
        </form>
      ) : <p className="text-sm text-muted-foreground">Consulta de gerencia · Solo lectura</p>}
      <section className="space-y-4 rounded-xl border bg-background p-5">
        <h2 className="text-lg font-semibold">Jornadas asignadas · {vista.jornadas.length}</h2>
        {!vista.jornadas.length && <p className="text-sm">Todavía no hay salidas asignadas para esta fecha.</p>}
        <ul className="divide-y">
          {vista.jornadas.map((j) => (
            <li key={j.id} className="flex flex-wrap items-start justify-between gap-4 py-4">
              <div className="min-w-0 space-y-1 text-sm break-words">
                <Link href={`/despacho/unidades/${j.unidadId}`} className="font-medium hover:underline">
                  {j.unidad.placa}
                </Link>
                <p><Link href={`/despacho/operadores/${j.operadorId}`} className="hover:underline">
                  {j.operador.nombre}
                </Link></p>
                <p className="text-muted-foreground">Disponible desde {j.disponibleDesde.slice(0, 5)}</p>
                {j.notas && <p>{j.notas}</p>}
              </div>
              {vista.puedeGestionar && <QuitarJornada key={`${j.id}-${j.version}`} jornada={j} />}
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-4 rounded-xl border bg-background p-5">
        <h2 className="text-lg font-semibold">No disponibles · {vista.noDisponibles.length}</h2>
        {!vista.noDisponibles.length && <p className="text-sm">No hay impedimentos registrados para esta fecha.</p>}
        <ul className="grid gap-5 sm:grid-cols-2">
          {vista.noDisponibles.map((n) => (
            <li key={`${n.tipo}-${n.id}`} className="min-w-0 space-y-3 rounded-lg border p-4 break-words">
              <Link
                href={`/despacho/${n.tipo === "unidad" ? "unidades" : "operadores"}/${n.id}`}
                className="font-medium hover:underline"
              >
                {n.nombre} · {n.tipo === "unidad" ? "Unidad" : "Operador"}
              </Link>
              <EstadoFlota motivos={n.motivos} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
