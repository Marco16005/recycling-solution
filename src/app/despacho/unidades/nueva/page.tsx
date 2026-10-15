import { Suspense } from "react";
import Link from "next/link";
import { contextoAltaFlotaConsulta } from "@/consultas/flota";
import { ResultadoFallido } from "@/components/clientes/resultado-fallido";
import { FormularioFlota } from "@/components/flota/formulario-flota";

async function Alta() {
  const resultado = await contextoAltaFlotaConsulta();
  if (!resultado.ok) return <ResultadoFallido resultado={resultado} />;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/despacho/unidades" className="text-sm text-muted-foreground hover:underline">Unidades /</Link>
      <h1 className="text-3xl font-semibold tracking-tight">Nueva unidad</h1>
      <FormularioFlota entidad="unidad" catalogo={resultado.valor.catalogoUnidad} />

    </div>
  );
}

export default function PaginaAltaUnidad() {
  return <Suspense fallback={<p role="status">Preparando alta…</p>}><Alta /></Suspense>;
}
