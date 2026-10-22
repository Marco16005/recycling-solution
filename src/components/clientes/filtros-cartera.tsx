import Link from "next/link";
import type { FiltrosCartera } from "@/consultas/cartera.nucleo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ParametrosCartera = Record<string, string | string[] | undefined>;

/** Los mismos parámetros viajan a lista, mapa y exportación. El servidor los valida. */
export function filtrosDeParametros(parametros: ParametrosCartera): FiltrosCartera {
  const valor = (nombre: string) => typeof parametros[nombre] === "string" ? (parametros[nombre] as string || undefined) : undefined;
  return {
    texto: valor("q"),
    residuo: valor("residuo") as FiltrosCartera["residuo"],
    estado: valor("estado") as FiltrosCartera["estado"],
    sinUbicacion: valor("sinUbicacion") === "1",
    documentos: valor("documentos") as FiltrosCartera["documentos"],
    activos: valor("activos") as FiltrosCartera["activos"],
  };
}

export function parametrosDeFiltros(filtros: FiltrosCartera): string {
  const parametros = new URLSearchParams();
  for (const [clave, valor] of Object.entries(filtros)) {
    if (valor !== undefined && valor !== false && valor !== "") parametros.set(clave === "texto" ? "q" : clave, valor === true ? "1" : valor);
  }
  return parametros.toString();
}

export function FiltrosDeCartera({ filtros, ruta }: { filtros: FiltrosCartera; ruta: string }) {
  const opciones = [
    ["residuo", "Residuo", [["", "Todos"], ["RSU", "RSU"], ["RME", "RME"], ["RP", "RP"]]],
    ["estado", "Estado de la ficha", [["", "Todos"], ["completo", "Completo"], ["incompleto", "Incompleto"], ["habilitado", "Habilitado hoy"], ["no_habilitado", "No habilitado"]]],
    ["documentos", "Documentos", [["", "Todos"], ["por_vencer", "Por vencer (30 días)"], ["vencidos", "Vencidos"]]],
    ["activos", "Actividad", [["activos", "Activos"], ["inactivos", "Inactivos"], ["todos", "Todos"]]],
  ] as const;
  return <section aria-label="Filtros" className="rounded-xl border bg-background p-5">
    <h2 className="mb-4 font-semibold">Filtros</h2>
    <form key={parametrosDeFiltros(filtros)} action={ruta} method="get" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="space-y-2 text-sm">Buscar clientes<Input name="q" maxLength={100} defaultValue={filtros.texto} placeholder="Nombre, contacto o dirección" /></label>
      {opciones.map(([nombre, titulo, valores]) => <label key={nombre} className="space-y-2 text-sm">{titulo}
        <select name={nombre} defaultValue={filtros[nombre] ?? (nombre === "activos" ? "activos" : "")} className="h-9 w-full rounded-lg border bg-background px-2">
          {valores.map(([valor, etiqueta]) => <option key={valor} value={valor}>{etiqueta}</option>)}
        </select>
      </label>)}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="sinUbicacion" value="1" defaultChecked={filtros.sinUbicacion} />Sin ubicación</label>
      <div className="flex items-center gap-3"><Button type="submit" variant="secondary">Buscar</Button><Link href={ruta} className="text-sm underline">Limpiar filtros</Link></div>
    </form>
  </section>;
}
