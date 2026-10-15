import { z } from "zod";
import { registrarEvento } from "@/datos/bitacora";
import { bloquearUnidadYOperador, leerCatalogo, leerOperador, leerUnidad } from "@/datos/flota";
import { bloquearJornadasDelDia, borrarJornadaSiVersion, fechaDeJornada, insertarJornada, leerJornadas } from "@/datos/jornadas";
import { jornadaTieneRutas, tomarCandadoDeFecha } from "@/datos/planes";
import { erroresPorCampo } from "@/dominio/clientes/esquemas";
import { ETIQUETA_NO_DISPONIBLE } from "@/dominio/clientes/etiquetas";
import { motivosNoDisponibleOperador, motivosNoDisponibleUnidad } from "@/dominio/flota/disponibilidad";
import type { MotivoNoDisponible } from "@/dominio/flota/tipos";
import { permitir } from "./autorizacion";
import type { Contexto, Resultado } from "./tipos";
import { esDuplicado, fechaSchema, idSchema, invalido, versionSchema } from "./validacion";

/** entrada de asignarJornada. disponibleDesde: "HH:MM". */
export interface AsignacionEntrada { fecha: string; unidadId: string; operadorId: string; disponibleDesde: string; notas: string | null }

const asignacionSchema = z.object({
  fecha: fechaSchema,
  unidadId: z.uuid("Elige una unidad"),
  operadorId: z.uuid("Elige un operador"),
  disponibleDesde: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Usa el formato HH:MM"),
  notas: z.string().trim().max(300).nullable(),
});

const describir = (motivos: MotivoNoDisponible[]) =>
  motivos.map((m) => (m.detalle ? `${ETIQUETA_NO_DISPONIBLE[m.codigo]}: ${m.detalle}` : ETIQUETA_NO_DISPONIBLE[m.codigo]));

/**
 * Permiso jornada.gestionar. Revalida en la transacción que la unidad y el operador estén activos, disponibles en la fecha
 * y sin otra jornada ese día. Si no: invalido con campos.unidadId u operadorId y el motivo.
 * Orden de bloqueos (Plan 4, §4): candado de la fecha, jornadas del día por id, y unidad y operador.
 */
export async function asignarJornada(ctx: Contexto, entrada: unknown): Promise<Resultado<{ id: string }>> {
  const permiso = permitir(ctx, "jornada.gestionar");
  if (!permiso.ok) return permiso;
  const validado = asignacionSchema.safeParse(entrada);
  if (!validado.success) return invalido(erroresPorCampo(validado.error));
  const datos = validado.data;
  const usuarioId = permiso.usuario.id;

  try {
    return await ctx.bd.transaction(async (tx): Promise<Resultado<{ id: string }>> => {
      await tomarCandadoDeFecha(tx, datos.fecha);
      await bloquearJornadasDelDia(tx, datos.fecha);
      await bloquearUnidadYOperador(tx, datos.unidadId, datos.operadorId);
      const unidad = await leerUnidad(tx, datos.unidadId);
      const operador = await leerOperador(tx, datos.operadorId);
      if (unidad === null) return invalido({ unidadId: ["La unidad no existe"] });
      if (operador === null) return invalido({ operadorId: ["El operador no existe"] });
      const motivosUnidad = unidad.activo ? motivosNoDisponibleUnidad(unidad, await leerCatalogo(tx, "unidad"), datos.fecha) : [{ codigo: "inactivo" as const, detalle: null }];
      if (motivosUnidad.length > 0) return invalido({ unidadId: describir(motivosUnidad) });
      const motivosOperador = operador.activo ? motivosNoDisponibleOperador(operador, await leerCatalogo(tx, "operador"), datos.fecha) : [{ codigo: "inactivo" as const, detalle: null }];
      if (motivosOperador.length > 0) return invalido({ operadorId: describir(motivosOperador) });
      const delDia = await leerJornadas(tx, datos.fecha);
      if (delDia.some((j) => j.unidadId === datos.unidadId)) return invalido({ unidadId: ["La unidad ya tiene jornada ese día"] });
      if (delDia.some((j) => j.operadorId === datos.operadorId)) return invalido({ operadorId: ["El operador ya tiene jornada ese día"] });

      const id = await insertarJornada(tx, datos, ctx.ahora);
      await registrarEvento(tx, { usuarioId, entidad: "jornada", entidadId: id, accion: "asignar", campos: ["fecha", "unidadId", "operadorId", "disponibleDesde"] });
      return { ok: true, valor: { id } };
    });
  } catch (error) {
    if (esDuplicado(error)) return invalido({ _: ["La unidad o el operador ya tiene jornada ese día"] });
    throw error;
  }
}

/** Permiso jornada.gestionar. Versión distinta: conflicto. Con rutas de un plan validado: conflicto jornada_con_rutas. */
export async function quitarJornada(ctx: Contexto, id: unknown, versionEsperada: unknown): Promise<Resultado<null>> {
  const permiso = permitir(ctx, "jornada.gestionar");
  if (!permiso.ok) return permiso;
  const valido = idSchema.safeParse(id);
  if (!valido.success) return { ok: false, error: "no_encontrado" };
  const version = versionSchema.safeParse(versionEsperada);
  if (!version.success) return invalido({ _: ["Falta la versión de la jornada"] });
  const usuarioId = permiso.usuario.id;

  const fecha = await fechaDeJornada(ctx.bd, valido.data);
  if (fecha === null) return { ok: false, error: "no_encontrado" };

  return ctx.bd.transaction(async (tx): Promise<Resultado<null>> => {
    await tomarCandadoDeFecha(tx, fecha);
    await bloquearJornadasDelDia(tx, fecha);
    if (await jornadaTieneRutas(tx, valido.data)) {
      return { ok: false, error: "conflicto", motivo: { codigo: "jornada_con_rutas", texto: "La jornada ya tiene rutas asignadas en un plan validado" } };
    }
    const r = await borrarJornadaSiVersion(tx, valido.data, version.data);
    if (r === "conflicto") return { ok: false, error: "conflicto" };
    if (r === "no_encontrado") return { ok: false, error: "no_encontrado" };
    await registrarEvento(tx, { usuarioId, entidad: "jornada", entidadId: valido.data, accion: "quitar", campos: [] });
    return { ok: true, valor: null };
  });
}
