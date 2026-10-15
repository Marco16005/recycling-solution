"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { cancelarSolicitudAccion, reprogramarSolicitudAccion } from "@/acciones/solicitudes";
import type { SolicitudGuardada } from "@/dominio/solicitudes/tipos";
import { Campo } from "@/components/clientes/campos-formulario";
import { MensajesOperacion, useOperacion } from "@/components/flota/operacion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function AccionesSolicitud({ solicitud, puedeCancelar, puedeRegistrar }: {
  solicitud: SolicitudGuardada;
  puedeCancelar: boolean;
  puedeRegistrar: boolean;
}) {
  const router = useRouter();
  const prefijo = useId();
  const op = useOperacion();
  const [accion, setAccion] = useState<"cancelar" | "reprogramar" | null>(null);
  const [motivo, setMotivo] = useState("");
  const [fecha, setFecha] = useState(solicitud.fechaSolicitada);
  const [terminada, setTerminada] = useState(false);
  const [version, setVersion] = useState(solicitud.version);
  const esperandoActualizacion = terminada && solicitud.version === version;
  function elegir(valor: "cancelar" | "reprogramar") {
    if (terminada && solicitud.version !== version) {
      setVersion(solicitud.version);
      setTerminada(false);
      setFecha(solicitud.fechaSolicitada);
      setMotivo("");
      op.setMensaje("");
    }
    setAccion(valor);
    op.setErrores({});
  }
  if (solicitud.estado !== "pendiente" || (!puedeCancelar && !puedeRegistrar)) return null;
  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex flex-wrap gap-2">
        {puedeRegistrar && (
          <Button
            type="button" variant="outline" disabled={op.pendiente || esperandoActualizacion}
            aria-expanded={accion === "reprogramar"} aria-controls={`${prefijo}-formulario`}
            onClick={() => elegir("reprogramar")}
          >Reprogramar</Button>
        )}
        {puedeCancelar && (
          <Button
            type="button" variant="outline" disabled={op.pendiente || esperandoActualizacion}
            aria-expanded={accion === "cancelar"} aria-controls={`${prefijo}-formulario`}
            onClick={() => elegir("cancelar")}
          >Cancelar solicitud</Button>
        )}
      </div>
      {accion && (
        <form
          id={`${prefijo}-formulario`} noValidate className="space-y-4"
          aria-label={`${accion === "cancelar" ? "Cancelar" : "Reprogramar"} ${solicitud.folio}`}
          onSubmit={(e) => {
            e.preventDefault();
            if (terminada || (accion === "cancelar" ? !puedeCancelar : !puedeRegistrar)) return;
            op.ejecutar(
              () => accion === "cancelar"
                ? cancelarSolicitudAccion(solicitud.id, version, motivo)
                : reprogramarSolicitudAccion(solicitud.id, version, fecha),
              () => {
                setTerminada(true);
                op.setMensaje(accion === "cancelar" ? "Solicitud cancelada." : "Solicitud reprogramada.");
                router.refresh();
              },
            );
          }}
        >
          <MensajesOperacion
            operacion={op} alRevisar={() => {
              setVersion(solicitud.version);
              op.setMensaje("Versión actual cargada. Revisa la captura antes de confirmar.");
            }}
          />
          <fieldset disabled={op.pendiente || op.conflicto || terminada} className="space-y-3">
            {accion === "cancelar" ? (
              <Campo nombre="motivo" titulo="Motivo de cancelación" prefijo={prefijo} errores={op.errores}>
                {(a) => <Textarea {...a} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
              </Campo>
            ) : (
              <Campo nombre="fecha" titulo="Nueva fecha solicitada" prefijo={prefijo} errores={op.errores}>
                {(a) => <Input {...a} type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />}
              </Campo>
            )}
            <p className="text-xs text-muted-foreground">
              {accion === "cancelar"
                ? "La solicitud quedará cerrada. El motivo se conservará en su historial."
                : "Conserva el folio y la hora original de registro en la cola."}
            </p>
            <div className="flex gap-2">
              <Button type="submit">{op.pendiente ? "Guardando…" : "Confirmar"}</Button>
              <Button type="button" variant="ghost" onClick={() => setAccion(null)}>Volver</Button>
            </div>
          </fieldset>
        </form>
      )}
    </div>
  );
}
