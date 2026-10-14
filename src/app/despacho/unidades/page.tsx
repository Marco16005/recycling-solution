import { Suspense } from "react";
import { listarUnidadesConsulta } from "@/consultas/flota";
import { ResultadoFallido } from "@/components/clientes/resultado-fallido";
import { ListadoFlota } from "@/components/flota/listado-flota";

type Props = { searchParams: Promise<{ q?: string | string[]; inactivos?: string | string[] }> };

async function Listado({ searchParams }: Props) {
  const parametros = await searchParams;
  const texto = typeof parametros.q === "string" ? parametros.q : "";
  const incluirInactivos = parametros.inactivos === "1";
  const resultado = await listarUnidadesConsulta({ texto, incluirInactivas: incluirInactivos });
  if (!resultado.ok) return <ResultadoFallido resultado={resultado} />;
  return (
    <ListadoFlota
      entidad="unidad" listado={resultado.valor} texto={texto} incluirInactivos={incluirInactivos}
    />
  );
}

export default function PaginaUnidades(props: Props) {
  return <Suspense fallback={<p role="status">Cargando unidades…</p>}><Listado {...props} /></Suspense>;
}
