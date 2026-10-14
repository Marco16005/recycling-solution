import { ETIQUETA_BLOQUEO } from "@/dominio/clientes/etiquetas";
import type { MotivoBloqueo } from "@/dominio/clientes/habilitacion";

export function MotivosCliente({ motivos }: { motivos: MotivoBloqueo[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {motivos.map((m, i) => (
        <li key={`${m.codigo}-${i}`}>{ETIQUETA_BLOQUEO[m.codigo]}{m.detalle ? `: ${m.detalle}` : ""}</li>
      ))}
    </ul>
  );
}
