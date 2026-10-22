import { Suspense } from "react";
import Link from "next/link";
import { mapaCarteraConsulta } from "@/consultas/cartera";
import { listarClientesConsulta } from "@/consultas/clientes";
import { ETIQUETA_BLOQUEO } from "@/dominio/clientes/etiquetas";
import { FiltrosDeCartera, filtrosDeParametros, parametrosDeFiltros, type ParametrosCartera } from "@/components/clientes/filtros-cartera";
import { MapaCarteraDinamico } from "@/components/clientes/mapa-cartera-dinamico";
import { ResultadoFallido } from "@/components/clientes/resultado-fallido";

type Props = { searchParams: Promise<ParametrosCartera> };

async function Contenido({ searchParams }: Props) {
  const filtros = filtrosDeParametros(await searchParams);
  // El contrato del mapa no incluye motivos: se toman del resumen autorizado de la cartera.
  const [mapa, lista] = await Promise.all([mapaCarteraConsulta(filtros), listarClientesConsulta(filtros)]);
  if (!mapa.ok) return <ResultadoFallido resultado={mapa} />;
  if (!lista.ok) return <ResultadoFallido resultado={lista} />;
  const resumenes = new Map(lista.valor.clientes.map((c) => [c.id, c]));
  const puntos = mapa.valor.puntos.map((p) => ({ ...p, motivos: resumenes.get(p.clienteId)?.motivosHoy.map((m) => `${ETIQUETA_BLOQUEO[m.codigo]}${m.detalle ? `: ${m.detalle}` : ""}`) ?? [] }));
  return <div className="space-y-6">
    <Link href={`/despacho/clientes?${parametrosDeFiltros(filtros)}`} className="text-sm underline">Volver a clientes</Link>
    <div><h1 className="text-3xl font-semibold tracking-tight">Mapa de la cartera</h1><p className="mt-2 text-sm text-muted-foreground">Ubicación y habilitación de los clientes hoy.</p></div>
    <FiltrosDeCartera filtros={filtros} ruta="/despacho/clientes/mapa" />
    <p role="status" className="rounded-lg border p-4 text-sm">{mapa.valor.sinUbicacion} clientes sin ubicación no tienen pin en el mapa.</p>
    {puntos.length === 0 && <p className="text-sm">No hay clientes con ubicación para estos filtros.</p>}
    <MapaCarteraDinamico puntos={puntos} estiloMapaUrl={mapa.valor.estiloMapaUrl} />
  </div>;
}

export default function PaginaMapa(props: Props) {
  return <Suspense fallback={<p role="status">Cargando cartera…</p>}><Contenido {...props} /></Suspense>;
}
