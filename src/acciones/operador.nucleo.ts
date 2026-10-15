import { z } from "zod";
import type { Tx } from "@/datos/bd";
import { registrarEvento } from "@/datos/bitacora";
import { leerConfiguracionCompleta } from "@/datos/configuracion";
import {
  bloquearJornada, bloquearSolicitudesDeParadas, estadoDeJornada, eventoPorId, incidentePorEvento, insertarEvento, insertarIncidente,
  leerJornadaOperacion, marcarDisponibilidad, marcarJornada, marcarParada, marcarRuta, solicitudAlSiguienteDia, solicitudAtendida,
  solicitudDeParada, solicitudesEnRuta, subirVersionOperacion, type FilaEvento, type JornadaOperacion,
} from "@/datos/operacion";
import { tomarCandadoDeFecha } from "@/datos/planes";
import { operadorDeUsuario } from "@/datos/usuarios";
import { aplicarEvento, huellaEvento } from "@/dominio/operacion";
import type { Efecto, EstadoJornada, EventoEntrada } from "@/dominio/operacion/tipos";
import { siguienteDiaOperacion } from "@/dominio/solicitudes/cola";
import { createHash } from "node:crypto";
import { permitir } from "./autorizacion";
import type { CodigoConflicto, Contexto, Resultado } from "./tipos";
import { esDuplicado, invalido, type Fallo } from "./validacion";

/**
 * Operación desde el teléfono (Plan 5, §3.3 y §4). Permiso ruta.operar, y solo sobre la jornada del propio operador:
 * se comprueba antes de buscar el evento, también al repetirlo.
 */

const conflicto = (codigo: CodigoConflicto, texto: string): Fallo => ({ ok: false, error: "conflicto", motivo: { codigo, texto } });

const eventoSchema = z.object({
  eventoId: z.uuid(),
  jornadaId: z.uuid(),
  tipo: z.enum(["check_in", "salida_patio", "llegada", "inicio_servicio", "fin_servicio", "no_atendida", "regreso_patio", "fin_descarga", "check_out"]),
  ocurridoEn: z.iso.datetime({ offset: true }),
  rutaId: z.uuid().nullable(),
  paradaId: z.uuid().nullable(),
  versionRuta: z.number().int().positive().nullable(),
  odometroKm: z.number().finite().nonnegative().max(9_999_999).nullable(),
  motivo: z.string().trim().min(1).max(200).nullable(),
});

export interface RespuestaEvento { resultado: "aplicado" | "rechazado"; motivo: string | null; repetido: boolean; estado: EstadoJornada }

/** La jornada, si es del operador de la sesión. null: no existe o es ajena (se responde no_encontrado). */
async function jornadaPropia(ctx: Contexto, usuarioId: string, jornadaId: string): Promise<JornadaOperacion | null> {
  const operadorId = await operadorDeUsuario(ctx.bd, usuarioId);
  if (operadorId === null) return null;
  const j = await leerJornadaOperacion(ctx.bd, jornadaId);
  return j !== null && j.operadorId === operadorId ? j : null;
}

/** El resultado guardado de un evento repetido, o el conflicto si el contenido es otro. */
async function respuestaDeRepetido(tx: Tx, previo: FilaEvento, huella: string, j: JornadaOperacion): Promise<Resultado<RespuestaEvento>> {
  if (previo.huella !== huella || previo.jornadaId !== j.id) return conflicto("evento_distinto", "Ese evento ya se registró con otro contenido");
  return {
    ok: true,
    valor: { resultado: previo.resultado, motivo: previo.motivoRechazo, repetido: true, estado: await estadoDeJornada(tx, j) },
  };
}

/** Registra un evento del operador. Rechazado o aplicado, queda guardado (decisión 9). */
export async function registrarEventoOperador(ctx: Contexto, evento: unknown): Promise<Resultado<RespuestaEvento>> {
  const permiso = permitir(ctx, "ruta.operar");
  if (!permiso.ok) return permiso;
  const validado = eventoSchema.safeParse(evento);
  if (!validado.success) return invalido({ _: ["El evento no es válido"] });
  const e: EventoEntrada = validado.data;
  const usuarioId = permiso.usuario.id;
  const leida = await jornadaPropia(ctx, usuarioId, e.jornadaId);
  if (leida === null) return { ok: false, error: "no_encontrado" };
  const huella = huellaEvento(e);

  try {
    return await ctx.bd.transaction(async (tx): Promise<Resultado<RespuestaEvento>> => {
      await tomarCandadoDeFecha(tx, leida.fecha);
      const j = await bloquearJornada(tx, e.jornadaId);
      if (j === null) return { ok: false, error: "no_encontrado" };
      // Con la jornada bloqueada: un envío simultáneo del mismo evento ya habrá quedado guardado.
      const previo = await eventoPorId(tx, e.eventoId);
      if (previo) return respuestaDeRepetido(tx, previo, huella, j);

      const estado = await estadoDeJornada(tx, j, true);
      await bloquearSolicitudesDeParadas(tx, estado.viajes.flatMap((v) => v.paradas.map((p) => p.paradaId)));
      const recibidoEn = ctx.ahora;
      const r = aplicarEvento(estado, e, recibidoEn.toISOString());
      const ocurrido = new Date(e.ocurridoEn);
      const fila = {
        eventoId: e.eventoId, jornadaId: j.id, rutaId: e.rutaId, paradaId: e.paradaId, tipo: e.tipo, ocurridoEn: ocurrido, recibidoEn,
        versionRuta: e.versionRuta, odometroKm: e.odometroKm, motivo: e.motivo, huella, usuarioId,
      };
      if (!r.ok) {
        await insertarEvento(tx, { ...fila, resultado: "rechazado", motivoRechazo: r.motivo.slice(0, 300) });
        await registrarEvento(tx, { usuarioId, entidad: "jornada", entidadId: j.id, accion: `evento_rechazado_${e.tipo}`, campos: [] });
        return { ok: true, valor: { resultado: "rechazado", motivo: r.motivo, repetido: false, estado } };
      }

      const campos = await aplicarEfectos(tx, r.efectos, j, ocurrido);
      await insertarEvento(tx, { ...fila, resultado: "aplicado", motivoRechazo: null });
      await subirVersionOperacion(tx, j.id);
      await registrarEvento(tx, { usuarioId, entidad: "jornada", entidadId: j.id, accion: `evento_${e.tipo}`, campos });
      return { ok: true, valor: { resultado: "aplicado", motivo: null, repetido: false, estado: await estadoDeJornada(tx, j) } };
    });
  } catch (error) {
    // Dos envíos del mismo evento a la vez: el otro ya lo guardó; se responde como repetido.
    if (!esDuplicado(error, "eventos_operador_evento_id_unique")) throw error;
    return ctx.bd.transaction(async (tx) => {
      const previo = await eventoPorId(tx, e.eventoId);
      if (!previo) throw error;
      return respuestaDeRepetido(tx, previo, huella, leida);
    });
  }
}

/** Aplica los efectos del dominio. Devuelve los nombres de campos para la bitácora. */
async function aplicarEfectos(tx: Tx, efectos: Efecto[], j: JornadaOperacion, en: Date): Promise<string[]> {
  const campos = new Set<string>();
  for (const efecto of efectos) {
    switch (efecto.tipo) {
      case "jornada":
        await marcarJornada(tx, j.id, efecto.campo, en);
        campos.add(efecto.campo);
        break;
      case "ruta":
        await marcarRuta(tx, efecto.rutaId, efecto.campo, en, efecto.odometroKm);
        campos.add(efecto.campo);
        break;
      case "disponibilidad_siguiente":
        await marcarDisponibilidad(tx, efecto.rutaId, en);
        campos.add("disponible_para_salir_en");
        break;
      case "parada":
        await marcarParada(tx, efecto.paradaId, efecto.estado, efecto.campos, en, efecto.motivo, efecto.liberar ?? false);
        campos.add("estado");
        efecto.campos.forEach((c) => campos.add(c));
        break;
      case "solicitudes":
        await solicitudesEnRuta(tx, efecto.rutaId, en);
        campos.add("solicitudes.estado");
        break;
      case "solicitud": {
        const solicitudId = await solicitudDeParada(tx, efecto.paradaId);
        if (solicitudId === null) throw new Error("Parada sin solicitud");
        if (efecto.estado === "atendida") await solicitudAtendida(tx, solicitudId, en);
        else {
          const { diasOperacion } = await leerConfiguracionCompleta(tx);
          await solicitudAlSiguienteDia(tx, solicitudId, siguienteDiaOperacion(j.fecha, diasOperacion), en);
        }
        campos.add("solicitudes.estado");
        break;
      }
    }
  }
  return [...campos];
}

// ---------- Incidentes

const incidenteSchema = z.object({
  eventoId: z.uuid(),
  jornadaId: z.uuid(),
  tipo: z.enum(["averia", "retraso", "cierre_vial", "cliente_no_disponible", "otro"]),
  descripcion: z.string().trim().min(1, "Describe brevemente el incidente").max(300),
  paradaId: z.uuid().nullable().optional(),
});

const huellaIncidente = (i: z.infer<typeof incidenteSchema>) =>
  createHash("sha256")
    .update(JSON.stringify([i.eventoId, i.jornadaId, i.tipo, i.descripcion, i.paradaId ?? null]))
    .digest("hex");

/** Idempotente por eventoId y huella. Sube version_operacion de la jornada. */
export async function reportarIncidente(ctx: Contexto, entrada: unknown): Promise<Resultado<{ id: string; repetido: boolean }>> {
  const permiso = permitir(ctx, "ruta.operar");
  if (!permiso.ok) return permiso;
  const validado = incidenteSchema.safeParse(entrada);
  if (!validado.success) return invalido({ descripcion: ["Describe brevemente el incidente (hasta 300 caracteres)"] });
  const i = validado.data;
  const usuarioId = permiso.usuario.id;
  const leida = await jornadaPropia(ctx, usuarioId, i.jornadaId);
  if (leida === null) return { ok: false, error: "no_encontrado" };
  const huella = huellaIncidente(i);

  const repetido = async (tx: Tx | typeof ctx.bd): Promise<Resultado<{ id: string; repetido: boolean }> | null> => {
    const previo = await incidentePorEvento(tx, i.eventoId);
    if (!previo) return null;
    if (previo.huella !== huella) return conflicto("evento_distinto", "Ese incidente ya se registró con otro contenido");
    return { ok: true, valor: { id: previo.id, repetido: true } };
  };

  try {
    return await ctx.bd.transaction(async (tx): Promise<Resultado<{ id: string; repetido: boolean }>> => {
      await tomarCandadoDeFecha(tx, leida.fecha);
      const j = await bloquearJornada(tx, i.jornadaId);
      if (j === null) return { ok: false, error: "no_encontrado" };
      const previo = await repetido(tx);
      if (previo) return previo;
      if (i.paradaId) {
        const estado = await estadoDeJornada(tx, j);
        if (!estado.viajes.some((v) => v.paradas.some((p) => p.paradaId === i.paradaId))) return invalido({ paradaId: ["Esa parada no es de tu jornada"] });
      }
      const id = await insertarIncidente(tx, {
        eventoId: i.eventoId, huella, jornadaId: j.id, paradaId: i.paradaId ?? null, tipo: i.tipo, descripcion: i.descripcion,
        reportadoEn: ctx.ahora, reportadoPor: usuarioId, creadoEn: ctx.ahora, actualizadoEn: ctx.ahora,
      });
      await subirVersionOperacion(tx, j.id);
      await registrarEvento(tx, { usuarioId, entidad: "incidente", entidadId: id, accion: "reportar", campos: ["tipo", "descripcion"] });
      return { ok: true, valor: { id, repetido: false } };
    });
  } catch (error) {
    if (!esDuplicado(error, "incidentes_evento_id_unique")) throw error;
    const previo = await repetido(ctx.bd);
    if (!previo) throw error;
    return previo;
  }
}
