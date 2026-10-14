import { Badge } from "@/components/ui/badge";
import type { Faltante } from "@/dominio/clientes/completitud";
import type { MotivoBloqueo } from "@/dominio/clientes/habilitacion";
import { ETIQUETA_BLOQUEO, ETIQUETA_FALTANTE } from "@/dominio/clientes/etiquetas";

export function EstadoCliente({ faltantes, motivos }: { faltantes: Faltante[]; motivos: MotivoBloqueo[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Badge variant={faltantes.length ? "outline" : "secondary"}>
          {faltantes.length ? "Incompleta" : "Completa"}
        </Badge>
        {faltantes.length > 0 && (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {faltantes.map((f) => (
              <li key={f}>{ETIQUETA_FALTANTE[f]}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-2">
        <Badge variant={motivos.length ? "outline" : "secondary"}>
          {motivos.length ? "No habilitada hoy" : "Habilitada hoy"}
        </Badge>
        {motivos.length > 0 && (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {motivos.map((m, i) => (
              <li key={`${m.codigo}-${i}`}>
                {ETIQUETA_BLOQUEO[m.codigo]}
                {m.detalle ? `: ${m.detalle}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
