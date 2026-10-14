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
      <Link href="/despacho/operadores" className="text-sm text-muted-foreground hover:underline">Operadores /</Link>
      <h1 className="text-3xl font-semibold tracking-tight">Nuevo operador</h1>
      <FormularioFlota entidad="operador" catalogo={resultado.valor.catalogoOperador} />
      <p className="text-sm">Guarda la ficha para registrar la entrega del aviso de privacidad.</p>
    </div>
  );
}

export default function PaginaAltaOperador() {
  return <Suspense fallback={<p role="status">Preparando alta…</p>}><Alta /></Suspense>;
}
