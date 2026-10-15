import { z } from "zod";
import { registrarEvento } from "@/datos/bitacora";
import { leerCliente } from "@/datos/clientes";
import { actualizarSolicitudPendiente, insertarSolicitud, siguienteConsecutivo, type ResultadoCambioSolicitud } from "@/datos/solicitudes";
import { erroresPorCampo } from "@/dominio/clientes/esquemas";
import { formatoFolio } from "@/dominio/solicitudes/cola";
import { solicitudSchema } from "@/dominio/solicitudes/esquemas";
import { fechaEnMexico } from "@/dominio/tiempo";
import { permitir } from "./autorizacion";
import type { Contexto, Resultado } from "./tipos";
import { fechaSchema, idSchema, invalido, versionSchema, type Fallo } from "./validacion";

const motivoSchema = z.string().trim().min(3, "Escribe el motivo").max(300);

/** Traduce el resultado de un cambio a una solicitud pendiente. */
function resultadoDeCambio(r: ResultadoCambioSolicitud): Resultado<null> {
  if (r === "actualizada") return { ok: true, valor: null };
  if (r === "no_pendiente") return invalido({ _: ["La solicitud ya no está pendiente"] });
  return { ok: false, error: r };
}

/** id y versión de una solicitud existente, o el fallo. */
function idYVersion(id: unknown, versionEsperada: unknown): { id: string; version: number } | Fallo {
  const valido = idSchema.safeParse(id);
  if (!valido.success) return { ok: false, error: "no_encontrado" };
  const version = versionSchema.safeParse(versionEsperada);
  if (!version.success) return invalido({ _: ["Falta la versión de la solicitud"] });
  return { id: valido.data, version: version.data };
}

/**
 * Permiso solicitudes.registrar. entrada: SolicitudEntrada (solicitudSchema). Folio del día de registro (Ciudad de México);
 * proxima_fecha_elegible = fecha solicitada; captura_fin_en = ctx.ahora. Cliente inactivo o inexistente: invalido.
 */
export async function registrarSolicitud(ctx: Contexto, entrada: unknown): Promise<Resultado<{ id: string; folio: string }>> {
  const permiso = permitir(ctx, "solicitudes.registrar");
  if (!permiso.ok) return permiso;
  const validado = solicitudSchema.safeParse(entrada);
  if (!validado.success) return invalido(erroresPorCampo(validado.error));
  const datos = validado.data;
  const hoy = fechaEnMexico(ctx.ahora);
  if (datos.fechaSolicitada < hoy) return invalido({ fechaSolicitada: ["La fecha no puede ser anterior a hoy"] });
  if (datos.capturaInicioEn !== null && datos.capturaInicioEn > ctx.ahora) {
    return invalido({ capturaInicioEn: ["Inicio de captura posterior al registro"] });
  }
  const usuarioId = permiso.usuario.id;

  return ctx.bd.transaction(async (tx): Promise<Resultado<{ id: string; folio: string }>> => {
    const cliente = await leerCliente(tx, datos.clienteId);
    if (cliente === null || !cliente.activo) return invalido({ clienteId: ["Elige un cliente activo"] });
    const folio = formatoFolio(hoy, await siguienteConsecutivo(tx, hoy));
    const id = await insertarSolicitud(tx, {
      folio,
      clienteId: datos.clienteId,
      registradaEn: ctx.ahora,
      registradaPor: usuarioId,
      fechaSolicitada: datos.fechaSolicitada,
      canal: datos.canal,
      cargaEstimadaKg: datos.cargaEstimadaKg,
      notas: datos.notas,
      capturaInicioEn: datos.capturaInicioEn,
      capturaFinEn: ctx.ahora,
    });
    await registrarEvento(tx, {
      usuarioId, entidad: "solicitud", entidadId: id, accion: "registrar",
      campos: ["clienteId", "fechaSolicitada", "canal", ...(datos.cargaEstimadaKg !== null ? ["cargaEstimadaKg"] : []), ...(datos.notas ? ["notas"] : [])],
    });
    return { ok: true, valor: { id, folio } };
  });
}

/** Permiso solicitudes.cancelar. motivo: texto de 3 a 300 caracteres. Solo pendientes; versión distinta: conflicto. */
export async function cancelarSolicitud(ctx: Contexto, id: unknown, versionEsperada: unknown, motivo: unknown): Promise<Resultado<null>> {
  const permiso = permitir(ctx, "solicitudes.cancelar");
  if (!permiso.ok) return permiso;
  const ids = idYVersion(id, versionEsperada);
  if ("ok" in ids) return ids;
  const texto = motivoSchema.safeParse(motivo);
  if (!texto.success) return invalido({ motivo: texto.error.issues.map((i) => i.message) });
  const usuarioId = permiso.usuario.id;

  return ctx.bd.transaction(async (tx) => {
    const r = await actualizarSolicitudPendiente(tx, ids.id, ids.version, { estado: "cancelada", motivoCancelacion: texto.data }, ctx.ahora);
    if (r === "actualizada") {
      await registrarEvento(tx, { usuarioId, entidad: "solicitud", entidadId: ids.id, accion: "cancelar", campos: ["estado", "motivoCancelacion"] });
    }
    return resultadoDeCambio(r);
  });
}

/** Permiso solicitudes.registrar. Cambia fecha solicitada y próxima elegible; nunca registrada_en. Solo pendientes. */
export async function reprogramarSolicitud(ctx: Contexto, id: unknown, versionEsperada: unknown, fecha: unknown): Promise<Resultado<null>> {
  const permiso = permitir(ctx, "solicitudes.registrar");
  if (!permiso.ok) return permiso;
  const ids = idYVersion(id, versionEsperada);
  if ("ok" in ids) return ids;
  const nueva = fechaSchema.safeParse(fecha);
  if (!nueva.success) return invalido({ fecha: ["Fecha no válida"] });
  if (nueva.data < fechaEnMexico(ctx.ahora)) return invalido({ fecha: ["La fecha no puede ser anterior a hoy"] });
  const usuarioId = permiso.usuario.id;

  return ctx.bd.transaction(async (tx) => {
    const r = await actualizarSolicitudPendiente(tx, ids.id, ids.version, { fechaSolicitada: nueva.data, proximaFechaElegible: nueva.data }, ctx.ahora);
    if (r === "actualizada") {
      await registrarEvento(tx, { usuarioId, entidad: "solicitud", entidadId: ids.id, accion: "reprogramar", campos: ["fechaSolicitada", "proximaFechaElegible"] });
    }
    return resultadoDeCambio(r);
  });
}
