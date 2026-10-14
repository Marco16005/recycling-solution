"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { registrarPrivacidadAccion } from "@/acciones/clientes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ACCIONES_PRIVACIDAD,
  MEDIOS_PRIVACIDAD,
  type AccionPrivacidad,
  type EstadoPrivacidad,
  type MedioPrivacidad,
} from "@/dominio/clientes/tipos";
import { ETIQUETA_ACCION_PRIVACIDAD, ETIQUETA_MEDIO_PRIVACIDAD } from "@/dominio/clientes/etiquetas";
import { avisoVigente } from "@/dominio/clientes/completitud";
import { Campo, CLASE_SELECT, ResumenErrores, type Errores } from "./campos-formulario";
import { ResultadoFallido, type Fallo } from "./resultado-fallido";

export function PrivacidadCliente({
  clienteId,
  privacidad,
  versionAviso,
  puedeEditar,
}: {
  clienteId: string | null;
  privacidad: EstadoPrivacidad | null;
  versionAviso: string;
  puedeEditar: boolean;
}) {
  const prefijo = useId();
  const router = useRouter();
  const [accion, setAccion] = useState<AccionPrivacidad>("aceptado");
  const [medio, setMedio] = useState<MedioPrivacidad>("papel");
  const [errores, setErrores] = useState<Errores>({});
  const [fallo, setFallo] = useState<Fallo | null>(null);
  const [conflicto, setConflicto] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [pendiente, iniciar] = useTransition();

  function registrar(evento: FormEvent) {
    evento.preventDefault();
    if (!clienteId || !puedeEditar || pendiente || conflicto) return;
    setErrores({});
    setFallo(null);
    setMensaje("");
    iniciar(async () => {
      let resultado;
      try {
        resultado = await registrarPrivacidadAccion(clienteId, {
          accion,
          medio,
          versionAviso,
          movimientoAnteriorId: privacidad?.id ?? null,
        });
      } catch {
        setErrores({ _: ["No se pudo confirmar el movimiento. Recarga el estado antes de reintentar."] });
        setConflicto(true);
        return;
      }
      if (!resultado.ok) {
        if (resultado.error === "invalido") setErrores(resultado.campos);
        else if (resultado.error === "conflicto") setConflicto(true);
        else setFallo(resultado);
        return;
      }
      setMensaje("Movimiento registrado. Actualizando el estado…");
      setConflicto(true);
      router.refresh();
    });
  }

  return (
    <section
      className="space-y-4 rounded-xl border bg-background p-5 sm:p-6"
      aria-labelledby={`${prefijo}-titulo`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${prefijo}-titulo`} className="text-lg font-semibold">
          06 · Aviso de privacidad
        </h2>
        <Badge variant={avisoVigente(privacidad, versionAviso) ? "secondary" : "outline"}>
          {privacidad ? ETIQUETA_ACCION_PRIVACIDAD[privacidad.accion] : "Sin registro"}
        </Badge>
      </div>
      <p className="text-sm">
        Versión vigente del aviso: <strong>{versionAviso}</strong>
      </p>
      {privacidad && (
        <p className="text-sm text-muted-foreground">
          Último movimiento: {ETIQUETA_ACCION_PRIVACIDAD[privacidad.accion]} · versión{" "}
          {privacidad.versionAviso} · {ETIQUETA_MEDIO_PRIVACIDAD[privacidad.medio]} ·{" "}
          <time dateTime={new Date(privacidad.en).toISOString()}>
            {new Date(privacidad.en).toLocaleString("es-MX", {
              timeZone: "America/Mexico_City",
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </time>
        </p>
      )}
      {!avisoVigente(privacidad, versionAviso) && (
        <p className="text-sm text-muted-foreground">
          Hace falta una aceptación de la versión vigente para habilitar recolecciones.
        </p>
      )}
      {!clienteId ? (
        <p className="text-sm">
          Primero guarda el cliente. Después podrás registrar la aceptación o el retiro del aviso.
        </p>
      ) : (
        puedeEditar && (
          <form
            onSubmit={registrar}
            noValidate
            className="space-y-4"
            aria-label="Registrar aviso de privacidad"
          >
            {fallo && <ResultadoFallido resultado={fallo} />}
            <ResumenErrores errores={errores} />
            {mensaje && (
              <p role="status" className="text-sm">
                {mensaje}
              </p>
            )}
            {conflicto && !mensaje && (
              <div role="alert" className="space-y-3 rounded-lg border border-amber-600/40 p-3 text-sm">
                <p>
                  El aviso o su último movimiento pudo cambiar. Recarga el estado y revísalo antes de
                  registrar otro movimiento. La captura de la ficha se conserva.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pendiente}
                  onClick={() =>
                    iniciar(() => {
                      router.refresh();
                      setConflicto(false);
                    })
                  }
                >
                  Recargar estado del aviso
                </Button>
              </div>
            )}
            <fieldset disabled={pendiente || conflicto} className="grid gap-4 sm:grid-cols-2">
              <Campo nombre="accion" titulo="Movimiento" prefijo={prefijo} errores={errores}>
                {(a) => (
                  <select
                    {...a}
                    className={CLASE_SELECT}
                    value={accion}
                    onChange={(e) => setAccion(e.target.value as AccionPrivacidad)}
                  >
                    {ACCIONES_PRIVACIDAD.map((v) => (
                      <option key={v} value={v}>
                        {v === "aceptado" ? "Registrar aceptación" : "Registrar retiro"}
                      </option>
                    ))}
                  </select>
                )}
              </Campo>
              <Campo nombre="medio" titulo="Medio de registro" prefijo={prefijo} errores={errores}>
                {(a) => (
                  <select
                    {...a}
                    className={CLASE_SELECT}
                    value={medio}
                    onChange={(e) => setMedio(e.target.value as MedioPrivacidad)}
                  >
                    {MEDIOS_PRIVACIDAD.map((v) => (
                      <option key={v} value={v}>
                        {ETIQUETA_MEDIO_PRIVACIDAD[v]}
                      </option>
                    ))}
                  </select>
                )}
              </Campo>
            </fieldset>
            <Button type="submit" variant="secondary" disabled={pendiente || conflicto}>
              {pendiente ? "Registrando…" : "Registrar movimiento"}
            </Button>
          </form>
        )
      )}
    </section>
  );
}
