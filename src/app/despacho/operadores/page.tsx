import { Suspense } from "react";
import { listarOperadoresConsulta } from "@/consultas/flota";
import { ResultadoFallido } from "@/components/clientes/resultado-fallido";
import { ListadoFlota } from "@/components/flota/listado-flota";

type Props = { searchParams: Promise<{ q?: string | string[]; inactivos?: string | string[] }> };

async function Listado({ searchParams }: Props) {
  const parametros = await searchParams;
  const texto = typeof parametros.q === "string" ? parametros.q : "";
  const incluirInactivos = parametros.inactivos === "1";
  const resultado = await listarOperadoresConsulta({ texto, incluirInactivos: incluirInactivos });
  if (!resultado.ok) return <ResultadoFallido resultado={resultado} />;
  return (
    <ListadoFlota
      entidad="operador" listado={resultado.valor} texto={texto} incluirInactivos={incluirInactivos}
    />
  );
}

export default function PaginaOperadores(props: Props) {
  return <Suspense fallback={<p role="status">Cargando operadores…</p>}><Listado {...props} /></Suspense>;
}
