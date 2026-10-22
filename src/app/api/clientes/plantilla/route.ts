import { plantillaCsv } from "@/consultas/cartera.nucleo";
import { contextoDeLaPeticion } from "@/seguridad/sesion";

/** Plantilla CSV para importar clientes (Plan CRM, §4.1). Permiso clientes.importar. */
export async function GET(): Promise<Response> {
  const r = await plantillaCsv(await contextoDeLaPeticion());
  if (!r.ok) return new Response(r.error, { status: r.error === "no_autenticado" ? 401 : r.error === "no_autorizado" ? 403 : 400 });
  return new Response(r.valor.contenido, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${r.valor.nombre}"`,
      "cache-control": "private, no-store",
    },
  });
}
