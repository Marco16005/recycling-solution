import { Badge } from "@/components/ui/badge";
import { ETIQUETA_NO_DISPONIBLE } from "@/dominio/clientes/etiquetas";
import type { DocumentoRegistrado, MotivoNoDisponible, TipoDocumento } from "@/dominio/flota/tipos";

export function EstadoFlota({
  motivos, porVencer = [], catalogo = [],
}: {
  motivos: MotivoNoDisponible[];
  porVencer?: DocumentoRegistrado[];
  catalogo?: TipoDocumento[];
}) {
  return (
    <div className="space-y-3 text-sm">
      <Badge variant={motivos.length ? "outline" : "secondary"}>
        {motivos.length ? "No disponible" : "Disponible"}
      </Badge>
      {motivos.length > 0 && (
        <ul className="space-y-1">
          {motivos.map((m, i) => (
            <li key={`${m.codigo}-${i}`}>
              {ETIQUETA_NO_DISPONIBLE[m.codigo]}{m.detalle ? `: ${m.detalle}` : ""}
            </li>
          ))}
        </ul>
      )}
      {porVencer.length > 0 && (
        <div className="border-l-2 border-amber-600 pl-3">
          <p className="font-medium">Vence en los próximos 30 días</p>
          <ul className="mt-1 space-y-1 text-muted-foreground">
            {porVencer.map((d) => (
              <li key={d.tipoDocumentoId}>
                {catalogo.find((t) => t.id === d.tipoDocumentoId)?.nombre ?? d.tipoDocumentoId}
                {" · "}<time dateTime={d.venceEl ?? undefined}>{d.venceEl}</time>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
