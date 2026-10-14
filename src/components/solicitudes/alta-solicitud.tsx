"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { buscarClientesParaSolicitudAccion, registrarSolicitudAccion } from "@/acciones/solicitudes";
import type { ClienteParaSolicitud } from "@/consultas/solicitudes";
import { Campo, CLASE_SELECT } from "@/components/clientes/campos-formulario";
import { ResultadoFallido, type Fallo } from "@/components/clientes/resultado-fallido";
import { MensajesOperacion, useOperacion } from "@/components/flota/operacion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ETIQUETA_CANAL } from "@/dominio/clientes/etiquetas";
import { CANALES, type Canal } from "@/dominio/solicitudes/tipos";
import { solicitudSchema } from "@/dominio/solicitudes/esquemas";
import { erroresPorCampo } from "@/dominio/clientes/esquemas";
import { MotivosCliente } from "./motivos-cliente";

export function AltaSolicitud({ hoy }: { hoy: string }) {
  const router = useRouter();
  const prefijo = useId();
  const op = useOperacion();
  const inicio = useRef<Date | null>(null);
  const busquedaActual = useRef(0);
  const buscador = useRef<HTMLInputElement>(null);
  const [texto, setTexto] = useState("");
  const [clientes, setClientes] = useState<ClienteParaSolicitud[]>([]);
  const [cliente, setCliente] = useState<ClienteParaSolicitud | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState("");
  const [falloBusqueda, setFalloBusqueda] = useState<Fallo | null>(null);
  const [fecha, setFecha] = useState(hoy);
  const [canal, setCanal] = useState<Canal>("telefono");
  const [carga, setCarga] = useState("");
  const [notas, setNotas] = useState("");

  useEffect(() => {
    if (cliente || !texto.trim()) return;
    const revision = busquedaActual.current;
    let vigente = true;
    const temporizador = setTimeout(async () => {
      try {
        const resultado = await buscarClientesParaSolicitudAccion(texto.trim());
        if (!vigente || revision !== busquedaActual.current) return;
        if (resultado.ok) setClientes(resultado.valor);
        else if (resultado.error === "invalido") {
          setErrorBusqueda(Object.values(resultado.campos).flat().join(" "));
        } else setFalloBusqueda(resultado);
      } catch {
        if (vigente && revision === busquedaActual.current) {
          setErrorBusqueda("No se pudo buscar. Revisa la conexión y vuelve a escribir el nombre.");
        }
      } finally {
        if (vigente && revision === busquedaActual.current) setBuscando(false);
      }
    }, 300);
    return () => { vigente = false; clearTimeout(temporizador); };
  }, [texto, cliente]);

  function empezar() {
    if (inicio.current === null) inicio.current = new Date();
  }

  function buscar(valor: string) {
    busquedaActual.current++;
    setTexto(valor);
    setCliente(null);
    setClientes([]);
    setBuscando(Boolean(valor.trim()));
    setErrorBusqueda("");
    setFalloBusqueda(null);
  }

  function guardar(e: FormEvent) {
    e.preventDefault();
    if (op.pendiente || op.conflicto) return;
    empezar();
    const entrada = {
      clienteId: cliente?.id ?? "", fechaSolicitada: fecha, canal,
      cargaEstimadaKg: carga === "" ? null : Number(carga), notas: notas || null,
      capturaInicioEn: inicio.current,
    };
    const validacion = solicitudSchema.safeParse(entrada);
    if (!validacion.success) { op.setErrores(erroresPorCampo(validacion.error)); return; }
    op.ejecutar(() => registrarSolicitudAccion(validacion.data), ({ folio }) => {
      buscar("");
      setFecha(hoy);
      setCanal("telefono");
      setCarga("");
      setNotas("");
      inicio.current = null;
      op.setMensaje(`Solicitud registrada · Folio ${folio}`);
      router.refresh();
      buscador.current?.focus();
    });
  }

  const errores = {
    ...op.errores,
    ...(errorBusqueda ? { clienteId: [...(op.errores.clienteId ?? []), errorBusqueda] } : {}),
  };
  return (
    <form
      onSubmit={guardar} onFocusCapture={empezar} onKeyDownCapture={empezar} noValidate
      aria-label="Alta rápida de solicitud" className="space-y-5 rounded-xl border bg-background p-5 sm:p-6"
    >
      <h2 className="text-lg font-semibold">Nueva solicitud</h2>
      <MensajesOperacion
        operacion={op} textoRevision="Ya revisé la cola; iniciar otra captura"
        alRevisar={() => {
          buscar("");
          setFecha(hoy);
          setCanal("telefono");
          setCarga("");
          setNotas("");
          inicio.current = null;
          op.setMensaje("Nueva captura. La anterior debe verificarse en la cola.");
          buscador.current?.focus();
        }}
      />
      {falloBusqueda && <ResultadoFallido resultado={falloBusqueda} />}
      <fieldset disabled={op.pendiente || op.conflicto} className="space-y-5">
        <Campo nombre="clienteId" titulo="Buscar cliente por nombre" prefijo={prefijo} errores={errores}>
          {(a) => (
            <Input
              {...a} ref={buscador} autoComplete="off" value={texto} onChange={(e) => buscar(e.target.value)}
              aria-describedby={[a["aria-describedby"], `${prefijo}-busqueda`].filter(Boolean).join(" ")}
            />
          )}
        </Campo>
        <p id={`${prefijo}-busqueda`} role="status" className="text-sm text-muted-foreground">
          {cliente ? "Cliente seleccionado." : buscando ? "Buscando clientes…" : texto.trim()
            ? `${clientes.length} coincidencias. Selecciona un cliente para continuar.`
            : "Escribe el nombre. Se muestran hasta 10 coincidencias."}
        </p>
        {!cliente && clientes.length > 0 && (
          <ul aria-label="Coincidencias de clientes" className="max-h-80 overflow-y-auto rounded-lg border divide-y">
            {clientes.map((c) => (
              <li key={c.id} className="space-y-2 p-3">
                <Button
                  type="button" variant="outline" className="h-auto max-w-full py-2 whitespace-normal"
                  onClick={() => {
                    busquedaActual.current++;
                    setCliente(c);
                    setTexto(c.nombre);
                    setClientes([]);
                    setBuscando(false);
                  }}
                >
                  Seleccionar {c.nombre}
                </Button>
                <p className="text-sm text-muted-foreground">{c.direccion ?? "Sin dirección"}</p>
                {c.motivosHoy.length > 0 && <MotivosCliente motivos={c.motivosHoy} />}
              </li>
            ))}
          </ul>
        )}
        {cliente && (
          <div className="space-y-2 rounded-lg bg-muted/40 p-4">
            <p className="font-medium break-words">{cliente.nombre}</p>
            <p className="text-sm text-muted-foreground">{cliente.direccion ?? "Sin dirección"}</p>
            {cliente.motivosHoy.length > 0 ? (
              <>
                <p className="text-sm font-medium">Impedimentos de hoy</p>
                <MotivosCliente motivos={cliente.motivosHoy} />
                <p className="text-xs">Puedes registrar la solicitud; se evaluará para su fecha de operación.</p>
              </>
            ) : <p className="text-sm">Sin impedimentos hoy.</p>}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo nombre="fechaSolicitada" titulo="Fecha solicitada" prefijo={prefijo} errores={op.errores}>
            {(a) => <Input {...a} type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />}
          </Campo>
          <Campo nombre="canal" titulo="Canal" prefijo={prefijo} errores={op.errores}>
            {(a) => (
              <select
                {...a} className={CLASE_SELECT} value={canal} onChange={(e) => setCanal(e.target.value as Canal)}
              >
                {CANALES.map((c) => <option key={c} value={c}>{ETIQUETA_CANAL[c]}</option>)}
              </select>
            )}
          </Campo>
          <Campo nombre="cargaEstimadaKg" titulo="Carga estimada (kg, opcional)" prefijo={prefijo} errores={op.errores}>
            {(a) => (
              <Input
                {...a} type="number" min={1} max={60000} step="any" value={carga}
                onChange={(e) => setCarga(e.target.value)}
                placeholder={cliente?.cargaEstimadaKg?.toString() ?? "Por omisión"}
                aria-describedby={[a["aria-describedby"], `${prefijo}-carga`].filter(Boolean).join(" ")}
              />
            )}
          </Campo>
        </div>
        <p id={`${prefijo}-carga`} className="text-sm text-muted-foreground">
          {carga !== "" ? "Se usará la carga capturada para esta solicitud." : cliente?.cargaEstimadaKg != null
            ? `Sin carga capturada se usarán ${cliente.cargaEstimadaKg.toLocaleString("es-MX")} kg del cliente.`
            : "Sin carga del cliente ni de la solicitud se usará la carga por omisión de la configuración."}
        </p>
        <Campo nombre="notas" titulo="Notas (opcional)" prefijo={prefijo} errores={op.errores}>
          {(a) => <Textarea {...a} value={notas} onChange={(e) => setNotas(e.target.value)} />}
        </Campo>
      </fieldset>
      <Button type="submit" disabled={op.pendiente || op.conflicto}>
        {op.pendiente ? "Registrando…" : "Registrar solicitud"}
      </Button>
      {op.conflicto && (
        <p className="text-sm">Revisa la cola para comprobar si se creó el folio antes de iniciar otra captura.</p>
      )}
    </form>
  );
}
