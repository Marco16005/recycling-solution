"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ResumenErrores, type Errores } from "@/components/clientes/campos-formulario";
import { ResultadoFallido, type Fallo } from "@/components/clientes/resultado-fallido";

/** Estado común de acciones: errores accesibles y bloqueo tras conflicto o respuesta incierta. */
export function useOperacion() {
  const [errores, setErrores] = useState<Errores>({});
  const [fallo, setFallo] = useState<Fallo | null>(null);
  const [conflicto, setConflicto] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [pendiente, iniciar] = useTransition();

  function ejecutar<T>(accion: () => Promise<{ ok: true; valor: T } | Fallo>, exito: (valor: T) => void) {
    if (pendiente || conflicto) return;
    setErrores({});
    setFallo(null);
    setMensaje("");
    iniciar(async () => {
      let resultado;
      try {
        resultado = await accion();
      } catch {
        setErrores({ _: ["No se pudo confirmar la operación. Consulta el estado antes de volver a enviarla."] });
        setConflicto(true);
        return;
      }
      if (!resultado.ok) {
        if (resultado.error === "invalido") setErrores(resultado.campos);
        else if (resultado.error === "conflicto") setConflicto(true);
        else setFallo(resultado);
        return;
      }
      exito(resultado.valor);
    });
  }

  return { errores, setErrores, fallo, conflicto, setConflicto, mensaje, setMensaje, pendiente, ejecutar };
}

export function MensajesOperacion({ operacion, alRevisar, textoRevision = "Revisé el estado; continuar" }: {
  operacion: ReturnType<typeof useOperacion>;
  alRevisar?: () => void;
  textoRevision?: string;
}) {
  const router = useRouter();
  const [consultado, setConsultado] = useState(false);
  const [recargando, recargar] = useTransition();
  return (
    <>
      {operacion.fallo && <ResultadoFallido resultado={operacion.fallo} />}
      <ResumenErrores errores={operacion.errores} />
      {operacion.mensaje && <p role="status" className="text-sm">{operacion.mensaje}</p>}
      {operacion.conflicto && (
        <div role="alert" className="space-y-3 rounded-lg border border-amber-600/40 p-4 text-sm">
          <p>Los datos pudieron cambiar. Conservamos tu captura; consulta el estado actual antes de continuar.</p>
          <Button
            type="button" variant="outline" disabled={recargando}
            onClick={() => {
              setConsultado(true);
              recargar(() => router.refresh());
            }}
          >
            {recargando ? "Consultando…" : "Consultar estado actual"}
          </Button>
          {consultado && !recargando && alRevisar && (
            <Button
              type="button" variant="secondary" className="ml-2 h-auto py-2 whitespace-normal"
              onClick={() => {
                setConsultado(false);
                operacion.setConflicto(false);
                operacion.setErrores({});
                alRevisar();
              }}
            >
              {textoRevision}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
