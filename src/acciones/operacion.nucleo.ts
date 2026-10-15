import { z } from "zod";
import { registrarEvento } from "@/datos/bitacora";
import { fechaDeJornada } from "@/datos/jornadas";
import {
  bloquearJornada, conciliar, incidentePorId, leerIncidenteParaCambiar, marcarParada, paradasPorId, resolverIncidenteSiVersion,
  subirVersionOperacion,
} from "@/datos/operacion";
import { tomarCandadoDeFecha } from "@/datos/planes";
import { cancelarPorIncidente } from "@/datos/solicitudes";
import { permitir } from "./autorizacion";
import type { Contexto, Resultado } from "./tipos";
import { idSchema, invalido, versionSchema } from "./validacion";

/** Despachador ante la operación del día (Plan 5, §3.3 y §4). */

const conciliacionSchema = z.object({ nota: z.string().trim().min(1, "Escribe qué se acordó").max(300) });

/** Permiso operacion.conciliar. Marca un evento rechazado como conciliado, con una nota. */
export async function conciliarEvento(ctx: Contexto, eventoId: unknown, entrada: unknown): Promise<Resultado<null>> {
  const permiso = permitir(ctx, "operacion.conciliar");
  if (!permiso.ok) return permiso;
  const id = idSchema.safeParse(eventoId);
  if (!id.success) return { ok: false, error: "no_encontrado" };
  const validado = conciliacionSchema.safeParse(entrada);
  if (!validado.success) return invalido({ nota: ["Escribe qué se acordó (hasta 300 caracteres)"] });
  return ctx.bd.transaction(async (tx): Promise<Resultado<null>> => {
    if (!(await conciliar(tx, id.data, permiso.usuario.id, validado.data.nota, ctx.ahora))) return { ok: false, error: "no_encontrado" };
    await registrarEvento(tx, { usuarioId: permiso.usuario.id, entidad: "evento_operador", entidadId: null, accion: "conciliar", campos: ["conciliadoEn", "notaConciliacion"] });
    return { ok: true, valor: null };
  });
}

const resolucionSchema = z.object({ accion: z.enum(["continuar", "cancelar", "re_ruteo"]) });

/**
 * Permiso incidentes.resolver. cancelar: solo si el incidente tiene una parada vigente pendiente; cancela su solicitud,
 * deja la parada omitida sin vigencia y sube version_operacion, con los mismos bloqueos que un evento.
 */
export async function resolverIncidente(ctx: Contexto, id: unknown, versionEsperada: unknown, entrada: unknown): Promise<Resultado<{ version: number }>> {
  const permiso = permitir(ctx, "incidentes.resolver");
  if (!permiso.ok) return permiso;
  const valido = idSchema.safeParse(id);
  if (!valido.success) return { ok: false, error: "no_encontrado" };
  const version = versionSchema.safeParse(versionEsperada);
  if (!version.success) return invalido({ _: ["Falta la versión del incidente"] });
  const validado = resolucionSchema.safeParse(entrada);
  if (!validado.success) return invalido({ accion: ["Elige qué hacer con el incidente"] });
  const { accion } = validado.data;
  const usuarioId = permiso.usuario.id;

  const leido = await incidentePorId(ctx.bd, valido.data);
  if (leido === null) return { ok: false, error: "no_encontrado" };
  const fecha = await fechaDeJornada(ctx.bd, leido.jornadaId);
  if (fecha === null) return { ok: false, error: "no_encontrado" };

  return ctx.bd.transaction(async (tx): Promise<Resultado<{ version: number }>> => {
    // El mismo orden que un evento del operador: candado de la fecha, jornada y luego lo demás.
    await tomarCandadoDeFecha(tx, fecha);
    const jornada = await bloquearJornada(tx, leido.jornadaId);
    const previo = await leerIncidenteParaCambiar(tx, valido.data);
    if (previo === null || jornada === null) return { ok: false, error: "no_encontrado" };
    if (previo.version !== version.data || previo.resueltoEn !== null) return { ok: false, error: "conflicto" };
    if (accion === "cancelar") {
      if (previo.paradaId === null) return invalido({ accion: ["El incidente no tiene una parada que cancelar"] });
      const [parada] = await paradasPorId(tx, [previo.paradaId], true);
      if (!parada || !parada.vigente || parada.estado !== "pendiente") return invalido({ accion: ["Solo se cancela una parada pendiente"] });
      await marcarParada(tx, parada.id, "omitida", [], ctx.ahora, undefined, true);
      await cancelarPorIncidente(tx, parada.solicitudId, ctx.ahora);
      await subirVersionOperacion(tx, jornada.id);
      await registrarEvento(tx, { usuarioId, entidad: "solicitud", entidadId: parada.solicitudId, accion: "cancelar_por_incidente", campos: ["estado", "motivoCancelacion"] });
    }
    const nueva = await resolverIncidenteSiVersion(tx, previo.id, version.data, accion, usuarioId, ctx.ahora);
    if (nueva === null) return { ok: false, error: "conflicto" };
    await registrarEvento(tx, { usuarioId, entidad: "incidente", entidadId: previo.id, accion: `resolver_${accion}`, campos: ["accion", "resueltoEn"] });
    return { ok: true, valor: { version: nueva } };
  });
}
