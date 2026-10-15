import { Suspense } from "react";
import { ResultadoFallido } from "@/components/clientes/resultado-fallido";
import { PanelIndicadores } from "@/components/gerencia/panel-indicadores";
import { panelConsulta } from "@/consultas/indicadores";

type Props = { searchParams: Promise<{ desde?: string | string[]; hasta?: string | string[] }> };

const uno = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);

async function Contenido({ searchParams }: Props) {
  const { desde, hasta } = await searchParams;
  const resultado = await panelConsulta(uno(desde), uno(hasta));
  if (!resultado.ok) return <ResultadoFallido resultado={resultado} />;
  return <PanelIndicadores vista={resultado.valor} />;
}

export default function PaginaPanel(props: Props) {
  return <Suspense fallback={<p role="status">Calculando indicadores…</p>}><Contenido {...props} /></Suspense>;
}
