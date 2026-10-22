import { z } from "zod";
import { registrarEvento } from "@/datos/bitacora";
import { bloquearCliente } from "@/datos/clientes";
import { notasCliente } from "@/datos/esquema";
import { insertarNota } from "@/datos/notas";
import { leerUbicacion } from "@/dominio/clientes/ubicacion";
import { distanciaACalle } from "@/traslados";
import { and, eq } from "drizzle-orm";
import { permitir } from "./autorizacion";
import { resolverEnlaceCorto } from "./enlaces";
import type { Contexto, Resultado } from "./tipos";
import { idSchema, invalido } from "./validacion";

/** Plan CRM, §4.2 y §4.8: ubicación pegada y notas de seguimiento (permiso clientes.editar). */

/** Coordenadas del texto o enlace que manda el cliente; sigue enlaces cortos y mide la distancia a la calle con OSRM. */
export async function ubicacionDesdeTexto(ctx: Contexto, texto: unknown):
  Promise<Resultado<{ lat: number; lng: number; distanciaCalleM: number | null }>> {
  const permiso = permitir(ctx, "clientes.editar");
  if (!permiso.ok) return permiso;
  if (typeof texto !== "string" || texto.trim() === "" || texto.length > 2000) return invalido({ ubicacion: ["Pega la ubicación o el enlace"] });
  let lectura = leerUbicacion(texto);
  if (!lectura.ok && lectura.motivo === "enlace_corto") {
    const largo = await resolverEnlaceCorto(texto);
    if (!largo.ok) return invalido({ ubicacion: [largo.motivo] });
    lectura = leerUbicacion(largo.url);
  }
  if (!lectura.ok) return invalido({ ubicacion: [lectura.mensaje] });
  const distancia = await distanciaACalle({ lat: lectura.lat, lng: lectura.lng }, { url: process.env.OSRM_URL });
  return { ok: true, valor: { lat: lectura.lat, lng: lectura.lng, distanciaCalleM: distancia === null ? null : Math.round(distancia) } };
}

export type TipoNota = "llamada" | "queja" | "acuerdo" | "otro";
const notaSchema = z.object({
  tipo: z.enum(["llamada", "queja", "acuerdo", "otro"], "Elige el tipo de nota"),
  texto: z.string().trim().min(1, "Escribe la nota").max(1000, "Máximo 1000 caracteres"),
  corrigeA: z.uuid().nullable().optional(),
});

/** entrada: { tipo, texto (hasta 1000), corrigeA?: id de otra nota del mismo cliente }. Las notas solo se agregan. */
export async function agregarNota(ctx: Contexto, clienteId: unknown, entrada: unknown): Promise<Resultado<{ id: string }>> {
  const permiso = permitir(ctx, "clientes.editar");
  if (!permiso.ok) return permiso;
  const id = idSchema.safeParse(clienteId);
  if (!id.success) return { ok: false, error: "no_encontrado" };
  const validado = notaSchema.safeParse(entrada);
  if (!validado.success) return invalido(Object.fromEntries(validado.error.issues.map((i) => [String(i.path[0] ?? "_"), [i.message]])));
  const { tipo, texto, corrigeA } = validado.data;
  return ctx.bd.transaction(async (tx): Promise<Resultado<{ id: string }>> => {
    if (!(await bloquearCliente(tx, id.data))) return { ok: false, error: "no_encontrado" };
    if (corrigeA) {
      const [original] = await tx.select({ id: notasCliente.id }).from(notasCliente)
        .where(and(eq(notasCliente.id, corrigeA), eq(notasCliente.clienteId, id.data)));
      if (!original) return invalido({ corrigeA: ["La nota que se corrige no es de este cliente"] });
    }
    const nueva = await insertarNota(tx, { clienteId: id.data, tipo, texto, autor: permiso.usuario.id, corrigeA: corrigeA ?? null }, ctx.ahora);
    await registrarEvento(tx, { usuarioId: permiso.usuario.id, entidad: "nota_cliente", entidadId: nueva, accion: corrigeA ? "corregir_nota" : "crear_nota", campos: ["tipo", "texto"] });
    return { ok: true, valor: { id: nueva } };
  });
}
