import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { registrarEvento } from "@/datos/bitacora";
import { bloquearCliente, leerCliente } from "@/datos/clientes";
import { leerConfiguracionCompleta } from "@/datos/configuracion";
import { solicitudes } from "@/datos/esquema";
import { fechasAtendidas } from "@/datos/cartera";
import { decisionDe, decisionesDePropuestas, insertarDecisionPropuesta } from "@/datos/propuestas";
import { propuestasParaFecha, ritmoAprendido } from "@/dominio/solicitudes/propuestas";
import { insertarSolicitud, siguienteConsecutivo } from "@/datos/solicitudes";
import { diaSemanaDeFecha, motivosDeBloqueoCliente } from "@/dominio/clientes/habilitacion";
import { formatoFolio } from "@/dominio/solicitudes/cola";
import { fechaEnMexico } from "@/dominio/tiempo";
import type { Tx } from "@/datos/bd";
import { permitir } from "./autorizacion";
import type { Contexto, Resultado } from "./tipos";
import { fechaSchema, idSchema, invalido, type Fallo } from "./validacion";

/**
 * Plan CRM, §4.4: propuestas de recolección que confirma el despachador (permiso solicitudes.registrar).
 * Confirmar y la captura manual bloquean al cliente antes de revisar o insertar (registrarSolicitud hace lo mismo), así
 * que una confirmación nunca crea una solicitud si ya había una abierta.
 */

/** no_propuesta: no toca para esa fecha (sin ritmo ni recurrencia que la propongan, o con una posposición vigente). */
export type MotivoNoElegible = "inactivo" | "no_habilitado" | "solicitud_abierta" | "ya_decidida" | "no_propuesta" | "no_encontrado";

const ABIERTAS = ["pendiente", "programada", "en_ruta"] as const;

async function validarFecha(ctx: Contexto, fecha: unknown): Promise<string | Fallo> {
  const f = fechaSchema.safeParse(fecha);
  if (!f.success) return invalido({ fecha: ["Fecha no válida"] });
  if (f.data < fechaEnMexico(ctx.ahora)) return invalido({ fecha: ["La fecha no puede ser anterior a hoy"] });
  const config = await leerConfiguracionCompleta(ctx.bd);
  if (!config.diasOperacion.includes(diaSemanaDeFecha(f.data))) return invalido({ fecha: ["Ese día no es de operación"] });
  return f.data;
}

/** Con el cliente bloqueado: por qué no se puede proponer para la fecha, o null si sí. */
async function noElegible(tx: Tx, clienteId: string, fecha: string, versionAviso: string): Promise<MotivoNoElegible | null> {
  const cliente = await leerCliente(tx, clienteId);
  if (!cliente) return "no_encontrado";
  if (!cliente.activo) return "inactivo";
  if (motivosDeBloqueoCliente(cliente, fecha, versionAviso).length > 0) return "no_habilitado";
  const [abierta] = await tx.select({ id: solicitudes.id }).from(solicitudes)
    .where(and(eq(solicitudes.clienteId, clienteId), inArray(solicitudes.estado, [...ABIERTAS]))).limit(1);
  return abierta ? "solicitud_abierta" : null;
}

/**
 * Con el cliente bloqueado: por qué no se puede decidir hoy su propuesta para la fecha, o null si se propone de verdad.
 * Revisión de Codex: confirmar, posponer y descartar recalculan la propuesta, así una pantalla desactualizada no decide
 * sobre un cliente que ya no se propone (por ejemplo, con una posposición vigente).
 */
async function motivoParaNoDecidir(ctx: Contexto, tx: Tx, clienteId: string, dia: string): Promise<MotivoNoElegible | null> {
  const config = await leerConfiguracionCompleta(tx);
  const motivo = await noElegible(tx, clienteId, dia, config.versionAvisoPrivacidad);
  if (motivo) return motivo;
  const cliente = (await leerCliente(tx, clienteId))!;
  const candidato = {
    clienteId, activo: true, habilitadoEnFecha: true, tieneSolicitudAbierta: false, recurrencia: cliente.recurrencia,
    ritmo: ritmoAprendido((await fechasAtendidas(tx, [clienteId])).get(clienteId) ?? [], fechaEnMexico(ctx.ahora)),
    decisiones: (await decisionesDePropuestas(tx, [clienteId])).get(clienteId) ?? [],
  };
  return propuestasParaFecha(dia, config.diasOperacion, [candidato]).length === 0 ? "no_propuesta" : null;
}

export async function confirmarPropuestas(ctx: Contexto, fecha: unknown, clienteIds: unknown):
  Promise<Resultado<{ creadas: { clienteId: string; solicitudId: string; folio: string }[]; yaConfirmadas: string[];
    noElegibles: { clienteId: string; motivo: MotivoNoElegible }[] }>> {
  const permiso = permitir(ctx, "solicitudes.registrar");
  if (!permiso.ok) return permiso;
  const ids = z.array(z.uuid()).min(1).max(100).safeParse(clienteIds);
  if (!ids.success) return invalido({ clienteIds: ["Elige al menos una propuesta"] });
  const dia = await validarFecha(ctx, fecha);
  if (typeof dia !== "string") return dia;
  const usuarioId = permiso.usuario.id;
  const creadas: { clienteId: string; solicitudId: string; folio: string }[] = [];
  const yaConfirmadas: string[] = [];
  const noElegibles: { clienteId: string; motivo: MotivoNoElegible }[] = [];
  // Una transacción por cliente: una que no se puede confirmar no deshace las demás.
  for (const clienteId of [...new Set(ids.data)].sort()) {
    await ctx.bd.transaction(async (tx) => {
      if (!(await bloquearCliente(tx, clienteId))) { noElegibles.push({ clienteId, motivo: "no_encontrado" }); return; }
      const previa = await decisionDe(tx, clienteId, dia);
      if (previa) {
        if (previa.estado === "confirmada") yaConfirmadas.push(clienteId);
        else noElegibles.push({ clienteId, motivo: "ya_decidida" });
        return;
      }
      const motivo = await motivoParaNoDecidir(ctx, tx, clienteId, dia);
      if (motivo) { noElegibles.push({ clienteId, motivo }); return; }
      const hoy = fechaEnMexico(ctx.ahora);
      const folio = formatoFolio(hoy, await siguienteConsecutivo(tx, hoy));
      const solicitudId = await insertarSolicitud(tx, {
        folio, clienteId, registradaEn: ctx.ahora, registradaPor: usuarioId, fechaSolicitada: dia, canal: "propuesta",
        cargaEstimadaKg: null, notas: null, capturaInicioEn: ctx.ahora, capturaFinEn: ctx.ahora,
      });
      await insertarDecisionPropuesta(tx, { clienteId, fecha: dia, estado: "confirmada", pospuestaHasta: null, solicitudId, nota: null, decididaPor: usuarioId }, ctx.ahora);
      await registrarEvento(tx, { usuarioId, entidad: "solicitud", entidadId: solicitudId, accion: "registrar_desde_propuesta", campos: ["clienteId", "fechaSolicitada", "canal"] });
      creadas.push({ clienteId, solicitudId, folio });
    });
  }
  return { ok: true, valor: { creadas, yaConfirmadas, noElegibles } };
}

async function decidir(ctx: Contexto, fecha: unknown, clienteId: unknown, decision: { estado: "pospuesta" | "descartada"; dias?: number; nota: string | null }):
  Promise<Resultado<null>> {
  const permiso = permitir(ctx, "solicitudes.registrar");
  if (!permiso.ok) return permiso;
  const id = idSchema.safeParse(clienteId);
  if (!id.success) return { ok: false, error: "no_encontrado" };
  const dia = await validarFecha(ctx, fecha);
  if (typeof dia !== "string") return dia;
  return ctx.bd.transaction(async (tx): Promise<Resultado<null>> => {
    if (!(await bloquearCliente(tx, id.data))) return { ok: false, error: "no_encontrado" };
    if (await decisionDe(tx, id.data, dia)) return { ok: false, error: "conflicto" };
    const motivo = await motivoParaNoDecidir(ctx, tx, id.data, dia);
    if (motivo === "no_encontrado") return { ok: false, error: "no_encontrado" };
    if (motivo) return { ok: false, error: "conflicto" };
    const hasta = decision.estado === "pospuesta"
      ? new Date(Date.parse(`${dia}T00:00:00Z`) + decision.dias! * 86_400_000).toISOString().slice(0, 10) : null;
    const decisionId = await insertarDecisionPropuesta(tx, { clienteId: id.data, fecha: dia, estado: decision.estado, pospuestaHasta: hasta,
      solicitudId: null, nota: decision.nota, decididaPor: permiso.usuario.id }, ctx.ahora);
    await registrarEvento(tx, { usuarioId: permiso.usuario.id, entidad: "propuesta_recoleccion", entidadId: decisionId,
      accion: decision.estado === "pospuesta" ? "posponer" : "descartar", campos: decision.nota ? ["estado", "nota"] : ["estado"] });
    return { ok: true, valor: null };
  });
}

/** dias: 1 a 30. El cliente no se vuelve a proponer antes de fecha + dias. */
export async function posponerPropuesta(ctx: Contexto, fecha: unknown, clienteId: unknown, dias: unknown): Promise<Resultado<null>> {
  const n = z.number().int().min(1).max(30).safeParse(dias);
  if (!n.success) return permitir(ctx, "solicitudes.registrar").ok ? invalido({ dias: ["De 1 a 30 días"] }) : { ok: false, error: "no_autorizado" };
  return decidir(ctx, fecha, clienteId, { estado: "pospuesta", dias: n.data, nota: null });
}

/** Vale solo para esa fecha. nota: hasta 300 caracteres, opcional. */
export async function descartarPropuesta(ctx: Contexto, fecha: unknown, clienteId: unknown, nota: unknown): Promise<Resultado<null>> {
  const n = z.string().trim().max(300).nullable().safeParse(nota ?? null);
  if (!n.success) return invalido({ nota: ["Máximo 300 caracteres"] });
  return decidir(ctx, fecha, clienteId, { estado: "descartada", nota: n.data || null });
}
