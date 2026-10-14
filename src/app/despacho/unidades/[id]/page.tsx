import { Suspense } from "react";
import Link from "next/link";
import { obtenerUnidadConsulta } from "@/consultas/flota";
import { ResultadoFallido } from "@/components/clientes/resultado-fallido";
import { FormularioFlota } from "@/components/flota/formulario-flota";
import { EstadoFlota } from "@/components/flota/estado-flota";

type Props = { params: Promise<{ id: string }> };

async function Ficha({ params }: Props) {
  const { id } = await params;
  const resultado = await obtenerUnidadConsulta(id);
  if (!resultado.ok) return <ResultadoFallido resultado={resultado} />;
  const ficha = resultado.valor;
  const entidad = ficha.unidad;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/despacho/unidades" className="text-sm text-muted-foreground hover:underline">Unidades /</Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight break-words">{entidad.placa}</h1>
      </div>
      <section aria-label="Disponibilidad guardada" className="space-y-3 rounded-xl border bg-background p-5">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Datos guardados · {ficha.fecha}</p>
        <EstadoFlota motivos={entidad.motivos} porVencer={entidad.porVencer} catalogo={ficha.catalogo} />
      </section>
      <FormularioFlota key={id} entidad="unidad" ficha={ficha} catalogo={ficha.catalogo} />

    </div>
  );
}

export default function PaginaFichaUnidad(props: Props) {
  return <Suspense fallback={<p role="status">Cargando ficha…</p>}><Ficha {...props} /></Suspense>;
}
