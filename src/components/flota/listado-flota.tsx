import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ETIQUETA_UNIDAD } from "@/dominio/clientes/etiquetas";
import type { ListadoOperadores, ListadoUnidades } from "@/consultas/flota";
import { EstadoFlota } from "./estado-flota";

type Props = {
  texto: string;
  incluirInactivos: boolean;
} & (
  | { entidad: "unidad"; listado: ListadoUnidades }
  | { entidad: "operador"; listado: ListadoOperadores }
);

export function ListadoFlota(props: Props) {
  const { listado, texto, incluirInactivos } = props;
  const unidades = props.entidad === "unidad";
  const ruta = unidades ? "unidades" : "operadores";
  const titulo = unidades ? "Unidades" : "Operadores";
  const filas = props.entidad === "unidad" ? props.listado.unidades : props.listado.operadores;
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">Flota · {listado.fecha}</p>
          <h1 className="text-3xl font-semibold tracking-tight">{titulo}</h1>
          <p className="mt-2 text-sm text-muted-foreground">Disponibilidad y vigencia para la operación de hoy.</p>
        </div>
        {listado.puedeEditar && (
          <Link href={`/despacho/${ruta}/${unidades ? "nueva" : "nuevo"}`} className={buttonVariants()}>
            {unidades ? "Nueva unidad" : "Nuevo operador"}
          </Link>
        )}
      </div>
      {!listado.puedeEditar && <p className="text-sm text-muted-foreground">Consulta de gerencia · Solo lectura</p>}
      <form method="get" action={`/despacho/${ruta}`} className="flex flex-wrap items-end gap-4">
        <div className="min-w-48 flex-1 space-y-2">
          <Label htmlFor="buscar-flota">{unidades ? "Placa o número económico" : "Nombre del operador"}</Label>
          <Input key={texto} id="buscar-flota" name="q" defaultValue={texto} />
        </div>
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input
            key={String(incluirInactivos)} type="checkbox" name="inactivos" value="1"
            defaultChecked={incluirInactivos} className="size-4 accent-primary"
          />
          Incluir inactivos
        </label>
        <Button type="submit" variant="secondary">Buscar</Button>
        {(texto || incluirInactivos) && (
          <Link href={`/despacho/${ruta}`} className={buttonVariants({ variant: "ghost" })}>Limpiar</Link>
        )}
      </form>
      <section aria-label={`Listado de ${ruta}`} className="overflow-hidden rounded-xl border bg-background">
        <p className="border-b px-5 py-3 text-sm text-muted-foreground">{filas.length} registros</p>
        {filas.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm">
            {texto ? "No hay coincidencias. Prueba con otra búsqueda." : "Aún no hay registros para mostrar."}
          </p>
        ) : (
          <ul className="divide-y">
            {filas.map((fila) => (
              <li key={fila.id} className="grid gap-5 p-5 sm:grid-cols-2">
                <div className="min-w-0 space-y-2">
                  <Link href={`/despacho/${ruta}/${fila.id}`} className="font-medium break-words hover:underline">
                    {"placa" in fila ? fila.placa : fila.nombre}
                  </Link>
                  {"placa" in fila ? (
                    <p className="text-sm text-muted-foreground">
                      {ETIQUETA_UNIDAD[fila.tipo]} · {fila.capacidadKg.toLocaleString("es-MX")} kg
                      {fila.numeroEconomico ? ` · Económico ${fila.numeroEconomico}` : ""}
                    </p>
                  ) : <p className="text-sm text-muted-foreground">{fila.telefono ?? "Sin teléfono"}</p>}
                </div>
                <EstadoFlota motivos={fila.motivos} porVencer={fila.porVencer} catalogo={listado.catalogo} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
