import { Suspense } from "react";
import { obtenerPlanConsulta } from "@/consultas/plan";
import { ResultadoFallido } from "@/components/clientes/resultado-fallido";
import { PlanDelDia } from "@/components/plan/plan-del-dia";

type Props = { searchParams: Promise<{ fecha?: string | string[] }> };

async function Contenido({ searchParams }: Props) {
  const { fecha } = await searchParams;
  const resultado = await obtenerPlanConsulta(typeof fecha === "string" ? fecha : undefined);
  if (!resultado.ok) return <ResultadoFallido resultado={resultado} />;
  return <PlanDelDia vista={resultado.valor} />;
}

export default function PaginaPlan(props: Props) {
  return <Suspense fallback={<p role="status">Cargando plan del día…</p>}><Contenido {...props} /></Suspense>;
}
