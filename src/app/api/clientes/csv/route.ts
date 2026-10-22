import { csvDeCartera } from "@/consultas/cartera.nucleo";
import { contextoDeLaPeticion } from "@/seguridad/sesion";

/**
 * Exportación de la cartera (Plan CRM, §4.9). Permiso clientes.exportar; queda en la bitácora.
 * Filtros por URL: q, residuo, estado, sinUbicacion=1, documentos y activos.
 */
export async function GET(peticion: Request): Promise<Response> {
  const p = new URL(peticion.url).searchParams;
  const filtros = Object.fromEntries(Object.entries({
    texto: p.get("q"), residuo: p.get("residuo"), estado: p.get("estado"), sinUbicacion: p.get("sinUbicacion"),
    documentos: p.get("documentos"), activos: p.get("activos"),
  }).filter(([, v]) => v !== null && v !== ""));
  const r = await csvDeCartera(await contextoDeLaPeticion(), filtros);
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
