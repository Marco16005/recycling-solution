import { Suspense } from "react";
import Link from "next/link";
import { listarClientesConsulta } from "@/consultas/clientes";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EstadoCliente } from "@/components/clientes/estado-cliente";
import { ResultadoFallido } from "@/components/clientes/resultado-fallido";
import { ETIQUETA_RESIDUO } from "@/dominio/clientes/etiquetas";

import { FiltrosDeCartera, filtrosDeParametros, parametrosDeFiltros, type ParametrosCartera } from "@/components/clientes/filtros-cartera";

type Props = { searchParams: Promise<ParametrosCartera> };

async function Cartera({ searchParams }: Props) {
  const parametros = await searchParams;
  const filtros = filtrosDeParametros(parametros);
  const q = filtros.texto ?? "";
  const consulta = parametrosDeFiltros(filtros);
  const resultado = await listarClientesConsulta(filtros);
  if (!resultado.ok) return <ResultadoFallido resultado={resultado} />;
  const { k5, clientes, fecha, puedeEditar } = resultado.valor;
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Cartera · {fecha}</p>
          <h1 className="text-3xl font-semibold tracking-tight">Clientes</h1>
          <p className="mt-2 text-sm text-muted-foreground">Datos listos para planear cada recolección.</p>
        </div>
        {puedeEditar && (
          <div className="flex gap-2">
            <Link href="/despacho/clientes/importar" className={buttonVariants({ variant: "outline" })}>
              Importar CSV
            </Link>
            <Link href="/despacho/clientes/nuevo" className={buttonVariants()}>
              Nuevo cliente
            </Link>
          </div>
        )}
      </div>
      <section
        aria-label="Indicador K5 de toda la cartera"
        className="flex flex-wrap items-center gap-6 rounded-xl border bg-background p-6"
      >
        <p className="font-mono text-4xl font-medium tracking-tight tabular-nums">
          {k5.porcentaje.toLocaleString("es-MX", { maximumFractionDigits: 1 })}
          <span className="text-xl text-muted-foreground">%</span>
        </p>
        <div>
          <h2 className="font-medium">
            Fichas completas <span className="ml-2 text-xs text-muted-foreground">K5</span>
          </h2>
          <p className="mt-1 text-sm">
            {k5.completos} de {k5.activos} clientes activos
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Toda la cartera. Los filtros no modifican este indicador.
          </p>
        </div>
      </section>
      <div className="flex flex-wrap gap-3">
        <Link href={`/despacho/clientes/mapa?${consulta}`} className={buttonVariants({ variant: "outline" })}>Mapa de la cartera</Link>
        {puedeEditar && <a href={`/api/clientes/csv?${consulta}`} className={buttonVariants({ variant: "outline" })}>Exportar CSV</a>}
      </div>
      <FiltrosDeCartera filtros={filtros} ruta="/despacho/clientes" />
      <section className="overflow-hidden rounded-xl border bg-background" aria-label="Listado de clientes">
        <div className="border-b px-4 py-3 text-sm text-muted-foreground">
          {clientes.length} {clientes.length === 1 ? "cliente" : "clientes"}
          {q ? ` · Búsqueda: ${q}` : ""}
        </div>
        {clientes.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <h2 className="font-medium">{consulta ? "No hay coincidencias" : "La cartera está vacía"}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {consulta
                ? "Prueba con otro texto o limpia los filtros."
                : "Registra el primer cliente o importa un archivo CSV."}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Residuo</TableHead>
                <TableHead>Ficha y habilitación</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clientes.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="min-w-48 max-w-80 align-top whitespace-normal">
                    <Link
                      href={`/despacho/clientes/${c.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {c.nombre}
                    </Link>
                    <p className="mt-1 text-xs text-muted-foreground">{c.direccion ?? "Sin dirección"}</p>
                    {c.documentoPorVencer && <p className="mt-2 inline-block rounded border border-amber-600/40 px-2 py-1 text-xs">Documento por vencer</p>}
                    {!c.activo && <p className="mt-2 text-xs">Inactivo</p>}
                  </TableCell>
                  <TableCell className="align-top">
                    {c.tipoResiduo ? ETIQUETA_RESIDUO[c.tipoResiduo] : "Sin definir"}
                  </TableCell>
                  <TableCell className="min-w-80 align-top whitespace-normal">
                    <EstadoCliente faltantes={c.faltantes} motivos={c.motivosHoy} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

export default function PaginaClientes(props: Props) {
  return (
    <Suspense fallback={<p role="status">Cargando cartera…</p>}>
      <Cartera {...props} />
    </Suspense>
  );
}
