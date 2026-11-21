import { seguimientoConsulta } from "@/consultas/operacion";
import { Seguimiento } from "@/components/plan/seguimiento";
import { Suspense } from "react";
import { obtenerPlanConsulta } from "@/consultas/plan";
import { ResultadoFallido } from "@/components/clientes/resultado-fallido";
import { PlanDelDia } from "@/components/plan/plan-del-dia";
import { obtenerPreparacionConsulta } from "@/consultas/preparacion";
import { ListaPreparacion } from "@/components/preparacion/lista-preparacion";

type Props = { searchParams: Promise<{ fecha?: string | string[]; plan?: string | string[] }> };

async function Contenido({ searchParams }: Props) {
  const { fecha, plan } = await searchParams;
  const resultado = await obtenerPlanConsulta(typeof fecha === "string" ? fecha : undefined, typeof plan === "string" ? plan : undefined);
  if (!resultado.ok) return <ResultadoFallido resultado={resultado} />;
  const seguimiento = resultado.valor.estado === "validado" ? await seguimientoConsulta(resultado.valor.fecha) : null;
  // Lista "Antes de generar" (diseño del 2026-11-21): mientras la fecha no tenga plan validado ni sea un re-ruteo.
  const preparacion = resultado.valor.estado !== "validado" && resultado.valor.tipo !== "re_ruteo"
    ? await obtenerPreparacionConsulta(resultado.valor.fecha) : null;
  const antesDeGenerar = preparacion && (preparacion.ok ? <ListaPreparacion preparacion={preparacion.valor} /> : <ResultadoFallido resultado={preparacion} />);
  return <><PlanDelDia vista={resultado.valor} antesDeGenerar={antesDeGenerar} />{seguimiento && (seguimiento.ok
    ? <Seguimiento vista={seguimiento.valor} plan={resultado.valor} /> : <ResultadoFallido resultado={seguimiento} />)}</>;
}

export default function PaginaPlan(props: Props) {
  return <Suspense fallback={<p role="status">Cargando plan del día…</p>}><Contenido {...props} /></Suspense>;
}
