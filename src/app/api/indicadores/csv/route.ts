import { csvDelRango } from "@/consultas/indicadores.nucleo";
import { contextoDeLaPeticion } from "@/seguridad/sesion";

/** CSV de recolecciones del rango (?desde=AAAA-MM-DD&hasta=AAAA-MM-DD) para las cartas X̄-R (Plan 6). Permiso indicadores.ver. */
export async function GET(peticion: Request): Promise<Response> {
  const url = new URL(peticion.url);
  const r = await csvDelRango(await contextoDeLaPeticion(), url.searchParams.get("desde") ?? undefined, url.searchParams.get("hasta") ?? undefined);
  if (!r.ok) {
    const estado = r.error === "no_autenticado" ? 401 : r.error === "no_autorizado" ? 403 : 400;
    return new Response(r.error === "invalido" ? Object.values(r.campos).flat().join(" ") : r.error, { status: estado });
  }
  return new Response(r.valor.contenido, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${r.valor.nombre}"`,
      "cache-control": "private, no-store",
    },
  });
}
