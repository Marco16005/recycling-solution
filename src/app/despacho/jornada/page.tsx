import { Suspense } from "react";
import { obtenerJornadaConsulta } from "@/consultas/jornada";
import { ResultadoFallido } from "@/components/clientes/resultado-fallido";
import { SelectorFecha } from "@/components/flota/selector-fecha";
import { Jornada } from "@/components/flota/jornada";

type Props = { searchParams: Promise<{ fecha?: string | string[] }> };

async function Contenido({ searchParams }: Props) {
  const { fecha } = await searchParams;
  const resultado = await obtenerJornadaConsulta(typeof fecha === "string" ? fecha : undefined);
  if (!resultado.ok) return <ResultadoFallido resultado={resultado} />;
  const vista = resultado.valor;
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Jornada</h1>
      <p className="text-sm text-muted-foreground">Asigna una unidad y un operador disponibles a cada salida.</p>
      <SelectorFecha fecha={vista.fecha} ruta="/despacho/jornada" />
      <Jornada key={vista.fecha} vista={vista} />
    </div>
  );
}

export default function PaginaJornada(props: Props) {
  return <Suspense fallback={<p role="status">Cargando jornada…</p>}><Contenido {...props} /></Suspense>;
}
