"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { registrarEntregaAvisoAccion } from "@/acciones/flota";
import type { FichaOperador } from "@/consultas/flota";
import { Button } from "@/components/ui/button";
import { MensajesOperacion, useOperacion } from "./operacion";

export function AvisoOperador({ ficha }: { ficha: FichaOperador }) {
  const router = useRouter();
  const op = useOperacion();
  const [terminada, setTerminada] = useState(false);
  const { operador, versionAvisoVigente, puedeEditar } = ficha;
  return (
    <section className="space-y-4 rounded-xl border bg-background p-5 sm:p-6">
      <h2 className="text-lg font-semibold">03 · Entrega del aviso de privacidad</h2>
      <p className="text-sm">Versión vigente: <strong>{versionAvisoVigente}</strong></p>
      <p className="text-sm text-muted-foreground">
        {operador.avisoVersion ? `Entregado: versión ${operador.avisoVersion}` : "Sin entrega registrada"}
        {operador.avisoEntregadoEn && ` · ${new Date(operador.avisoEntregadoEn).toLocaleString("es-MX", {
          timeZone: "America/Mexico_City", dateStyle: "medium", timeStyle: "short",
        })}`}
      </p>
      <a href="/aviso-de-privacidad" target="_blank" rel="noreferrer" className="text-sm underline">
        Leer aviso de privacidad (otra pestaña)
      </a>
      {puedeEditar && (
        <form
          className="space-y-4" onSubmit={(e) => {
            e.preventDefault();
            if (terminada) return;
            op.ejecutar(() => registrarEntregaAvisoAccion(operador.id, operador.version), () => {
              op.setMensaje("Entrega registrada. Actualizando ficha…");
              setTerminada(true);
              router.refresh();
            });
          }}
        >
          <MensajesOperacion operacion={op} alRevisar={() => op.setMensaje("Revisa la entrega registrada arriba.")} />
          <p className="text-sm">Confirma únicamente después de entregar el aviso al operador.</p>
          <Button type="submit" variant="secondary" disabled={op.pendiente || op.conflicto || terminada}>
            {op.pendiente ? "Registrando…" : "Confirmar entrega del aviso vigente"}
          </Button>
        </form>
      )}
    </section>
  );
}
