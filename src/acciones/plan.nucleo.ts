import { z } from "zod";
import { registrarEvento } from "@/datos/bitacora";
import { bloquearClientesCompartido, leerCartera } from "@/datos/clientes";
import { bloquearConfiguracionCompartido, leerConfiguracionCompleta, type ConfiguracionCompleta } from "@/datos/configuracion";
import { bloquearUnidadesYOperadores, leerCatalogo, leerOperadores, leerUnidades } from "@/datos/flota";
import { bloquearJornadasDelDia, leerJornadas } from "@/datos/jornadas";
import {
  bloquearSolicitudes, fijarRevisionIniciada, guardarAjuste, hayValidado, insertarRutas, leerPlan, marcarDescartado, marcarValidado,
  posponerSolicitudes, programarSolicitudes, propuestoDeFecha, tomarCandadoDeCatalogoFlota, tomarCandadoDeFecha,
} from "@/datos/planes";
import { leerSolicitudesParaCola } from "@/datos/solicitudes";
import { diaSemanaDeFecha } from "@/dominio/clientes/habilitacion";
import { construirEntrada, ErrorDeEntrada, MARGEN_REVISION_MIN, minutoEnMexico } from "@/dominio/plan/entrada";
import type { VersionesPlan } from "@/dominio/plan/tipos";
import { colaDelDia, siguienteDiaOperacion } from "@/dominio/solicitudes/cola";
import { fechaEnMexico } from "@/dominio/tiempo";
import { ajustarPlan, generarPlan, validarPlan, type AjusteManual, type EntradaPlan, type ResultadoAjuste } from "@/motor";
import {
  comprobarValidacion, conflicto, disponibleOperador, disponibleUnidad, ejecutarYGuardar, esFallo, LIMITE_MOTOR_MS, porVersion,
  propuestoEnVersion, rutasParaGuardar, solicitudesRuteadas, validarIdYVersionDePlan, ValidacionRechazada,
} from "./plan-comun";
import { permitir } from "./autorizacion";
import { validarReruteo } from "./reruteo.nucleo";
import type { Contexto, Resultado } from "./tipos";
import { esDuplicado, fechaSchema, idSchema, invalido, type Fallo } from "./validacion";

export { LIMITE_MOTOR_MS };

/**
 * Plan del día (Plan 4, §3.3 y §4). Generar, iniciar la revisión, ajustar y descartar: permiso planes.generar;
 * validar: planes.validar. Los conflictos llevan su motivo (CodigoConflicto).
 */

// ---------- Generar

interface Instantanea {
  config: ConfiguracionCompleta;
  entrada: EntradaPlan;
  versiones: VersionesPlan;
  esperado: { id: string; version: number } | null;
}

/** Ejecuta el motor sobre una instantánea y guarda la propuesta; registra la ejecución aunque falle (K7). */
export async function generarPlanDelDia(ctx: Contexto, fecha: unknown): Promise<Resultado<{ planId: string }>> {
  const permiso = permitir(ctx, "planes.generar");
  if (!permiso.ok) return permiso;
  const dia = fechaSchema.safeParse(fecha);
  if (!dia.success) return invalido({ fecha: ["Fecha no válida"] });
  const usuarioId = permiso.usuario.id;
  const hoy = fechaEnMexico(ctx.ahora);
  if (dia.data < hoy) return invalido({ fecha: ["No se puede planear una fecha pasada"] });

  const leida = await leerInstantaneaDePlan(ctx, dia.data);
  if (esFallo(leida)) return leida;
  const { entrada, versiones, esperado } = leida;

  return ejecutarYGuardar(ctx, {
    fecha: dia.data, usuarioId, entrada, versiones, esperado,
    correr: (e) => generarPlan(e),
    antesDeGuardar: async (tx) =>
      (await hayValidado(tx, dia.data))
        ? conflicto("plan_validado_existente", "La fecha ya tiene un plan validado; los cambios del día se hacen con el re-ruteo")
        : null,
    accion: "generar",
  });
}

/** Lee todo lo que necesita el motor en una sola instantánea y arma la entrada y sus versiones. */
async function leerInstantaneaDePlan(ctx: Contexto, fecha: string): Promise<Instantanea | Fallo> {
  const datos = await ctx.bd.transaction(
    async (tx) => ({
      config: await leerConfiguracionCompleta(tx),
      solicitudes: await leerSolicitudesParaCola(tx, fecha),
      cartera: await leerCartera(tx),
      jornadas: await leerJornadas(tx, fecha),
      unidades: await leerUnidades(tx),
      operadores: await leerOperadores(tx),
      catalogoUnidad: await leerCatalogo(tx, "unidad"),
      catalogoOperador: await leerCatalogo(tx, "operador"),
      esperado: await propuestoDeFecha(tx, fecha),
      validado: await hayValidado(tx, fecha),
    }),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  if (datos.validado) {
    return conflicto("plan_validado_existente", "La fecha ya tiene un plan validado; los cambios del día se hacen con el re-ruteo");
  }
  if (!datos.config.diasOperacion.includes(diaSemanaDeFecha(fecha))) {
    return invalido({ fecha: ["Ese día no es de operación"] });
  }

  const clientes = new Map(datos.cartera.map((c) => [c.id, c]));
  const cola = colaDelDia(datos.solicitudes, clientes, fecha, datos.config.versionAvisoPrivacidad, datos.config.diasOperacion, datos.config.diasParaAtrasada);
  const listas = cola.filter((e) => e.estado === "lista").map((e) => ({ solicitud: e.solicitud, cliente: clientes.get(e.solicitud.clienteId)! }));
  const unidades = new Map(datos.unidades.map((u) => [u.id, u]));
  const operadores = new Map(datos.operadores.map((o) => [o.id, o]));
  const disponibles = datos.jornadas.filter(
    (j) => disponibleUnidad(unidades.get(j.unidadId), datos.catalogoUnidad, fecha) && disponibleOperador(operadores.get(j.operadorId), datos.catalogoOperador, fecha),
  );

  let entrada: EntradaPlan;
  try {
    entrada = construirEntrada({
      fecha,
      ahora: ctx.ahora,
      solicitudes: listas,
      jornadas: disponibles.map((j) => ({ jornadaId: j.id, disponibleDesde: j.disponibleDesde, unidad: unidades.get(j.unidadId)! })),
      unidadesActivas: datos.unidades.filter((u) => u.activo),
      configuracion: datos.config,
    });
  } catch (error) {
    if (error instanceof ErrorDeEntrada && error.codigo === "sin_patio") {
      return invalido({ _: ["Configura la ubicación del patio antes de generar el plan"] });
    }
    if (error instanceof ErrorDeEntrada && error.codigo === "fecha_pasada") return invalido({ fecha: ["No se puede planear una fecha pasada"] });
    throw error;
  }

  const versiones: VersionesPlan = {
    solicitudes: porVersion(listas.map((l) => l.solicitud)),
    clientes: porVersion([...new Map(listas.map((l) => [l.cliente.id, l.cliente])).values()]),
    // Todas las jornadas de la fecha, también las no disponibles: una jornada nueva o quitada invalida la propuesta.
    jornadas: porVersion(datos.jornadas),
    unidades: porVersion(datos.jornadas.map((j) => unidades.get(j.unidadId)!)),
    operadores: porVersion(datos.jornadas.map((j) => operadores.get(j.operadorId)!)),
    configuracion: datos.config.version,
  };
  return { config: datos.config, entrada, versiones, esperado: datos.esperado };
}

// ---------- Revisión, ajustes y descarte

/** Fija revision_iniciada_en una sola vez (K6); no cambia la versión del plan. */
export async function iniciarRevision(ctx: Contexto, planId: unknown): Promise<Resultado<null>> {
  const permiso = permitir(ctx, "planes.generar");
  if (!permiso.ok) return permiso;
  const id = idSchema.safeParse(planId);
  if (!id.success) return { ok: false, error: "no_encontrado" };

  return ctx.bd.transaction(async (tx): Promise<Resultado<null>> => {
    if (await fijarRevisionIniciada(tx, id.data, ctx.ahora)) {
      await registrarEvento(tx, { usuarioId: permiso.usuario.id, entidad: "plan", entidadId: id.data, accion: "iniciar_revision", campos: ["revisionIniciadaEn"] });
      return { ok: true, valor: null };
    }
    return (await leerPlan(tx, id.data)) === null ? { ok: false, error: "no_encontrado" } : { ok: true, valor: null };
  });
}

const ajusteSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("mover"), solicitudId: z.uuid(), unidadId: z.uuid(), viaje: z.number().int().min(1), posicion: z.number().int().min(1) }),
  z.object({ tipo: z.literal("posponer"), solicitudId: z.uuid() }),
  // instanteMin lo calcula el servidor con la hora actual; el navegador no lo manda.
  z.object({ tipo: z.literal("actualizarHora") }),
]);

const TEXTO_CAUSA: Record<Extract<ResultadoAjuste, { error: "no_factible" }>["causa"], string> = {
  capacidad: "la carga del viaje supera la capacidad de la unidad",
  ventana: "no llega dentro de la ventana del cliente",
  finDeTurno: "la ruta terminaría después del fin del turno",
  tipoNoAdmitido: "el cliente no admite ese tipo de unidad",
};

/** ajuste: AjusteManual sin instanteMin. Con actualizarHora, el servidor calcula instanteMin. */
export async function ajustarPlanDelDia(ctx: Contexto, planId: unknown, versionEsperada: unknown, ajuste: unknown): Promise<Resultado<{ version: number }>> {
  const permiso = permitir(ctx, "planes.generar");
  if (!permiso.ok) return permiso;
  const ids = validarIdYVersionDePlan(planId, versionEsperada);
  if ("ok" in ids) return ids;
  const validado = ajusteSchema.safeParse(ajuste);
  if (!validado.success) return invalido({ _: ["El ajuste no es válido"] });
  const leido = await leerPlan(ctx.bd, ids.id);
  if (leido === null) return { ok: false, error: "no_encontrado" };
  const usuarioId = permiso.usuario.id;

  return ctx.bd.transaction(async (tx): Promise<Resultado<{ version: number }>> => {
    await tomarCandadoDeFecha(tx, leido.fecha);
    const plan = await propuestoEnVersion(tx, ids.id, ids.version);
    if (esFallo(plan)) return plan;

    let ajusteMotor: AjusteManual;
    if (validado.data.tipo === "actualizarHora") {
      if (plan.fecha !== fechaEnMexico(ctx.ahora)) return invalido({ _: ["Solo se actualizan los horarios del plan de hoy"] });
      const instanteMin = minutoEnMexico(ctx.ahora) + MARGEN_REVISION_MIN;
      if (instanteMin <= plan.entrada.instanteMin) return invalido({ _: ["Los horarios ya están al día"] });
      ajusteMotor = { tipo: "actualizarHora", instanteMin };
    } else {
      ajusteMotor = validado.data;
    }

    const r = ajustarPlan(plan.entrada, plan.resultado, ajusteMotor);
    if (!r.ok && r.error === "no_factible") {
      const folio = plan.entrada.solicitudes.find((s) => s.id === r.solicitudId)?.folio;
      return invalido({ _: [`No se puede: ${TEXTO_CAUSA[r.causa]}${folio ? ` (${folio})` : ""}`] });
    }
    if (!r.ok) return invalido({ _: ["El ajuste no es válido para este plan"] });
    const errores = validarPlan(r.entrada, r.plan, { ajustadoAMano: true });
    if (errores.length > 0) {
      console.error("[plan] un ajuste aceptado no pasó la validación", errores.length);
      return invalido({ _: ["No se pudo aplicar el ajuste. Avisa al administrador."] });
    }

    const version = await guardarAjuste(
      tx,
      plan.id,
      { resultado: r.plan, entrada: r.entrada, ajustes: [...plan.ajustes, { ajuste: ajusteMotor, por: usuarioId, en: ctx.ahora.toISOString() }] },
      ctx.ahora,
    );
    const campos = ajusteMotor.tipo === "actualizarHora" ? ["resultado", "ajustes", "entrada"] : ["resultado", "ajustes"];
    await registrarEvento(tx, { usuarioId, entidad: "plan", entidadId: plan.id, accion: `ajustar_${ajusteMotor.tipo}`, campos });
    return { ok: true, valor: { version } };
  });
}

/** Las solicitudes no se tocan. */
export async function descartarPlan(ctx: Contexto, planId: unknown, versionEsperada: unknown): Promise<Resultado<null>> {
  const permiso = permitir(ctx, "planes.generar");
  if (!permiso.ok) return permiso;
  const ids = validarIdYVersionDePlan(planId, versionEsperada);
  if ("ok" in ids) return ids;
  const leido = await leerPlan(ctx.bd, ids.id);
  if (leido === null) return { ok: false, error: "no_encontrado" };

  return ctx.bd.transaction(async (tx): Promise<Resultado<null>> => {
    await tomarCandadoDeFecha(tx, leido.fecha);
    const plan = await propuestoEnVersion(tx, ids.id, ids.version);
    if (esFallo(plan)) return plan;
    await marcarDescartado(tx, plan.id, ctx.ahora);
    await registrarEvento(tx, { usuarioId: permiso.usuario.id, entidad: "plan", entidadId: plan.id, accion: "descartar", campos: ["estado"] });
    return { ok: true, valor: null };
  });
}

// ---------- Validar

const confirmacionSchema = z.object({ requisitosConfirmados: z.literal(true) });

/** entrada: { requisitosConfirmados: true }. Todo en una transacción; las comprobaciones van antes de cualquier escritura. */
export async function validarPlanDelDia(
  ctx: Contexto,
  planId: unknown,
  versionEsperada: unknown,
  entrada: unknown,
): Promise<Resultado<{ programadas: number; pospuestas: number }>> {
  const permiso = permitir(ctx, "planes.validar");
  if (!permiso.ok) return permiso;
  const ids = validarIdYVersionDePlan(planId, versionEsperada);
  if ("ok" in ids) return ids;
  if (!confirmacionSchema.safeParse(entrada).success) {
    return invalido({ requisitosConfirmados: ["Confirma que los operadores cumplen los requisitos de acceso de sus clientes"] });
  }
  const leido = await leerPlan(ctx.bd, ids.id);
  if (leido === null) return { ok: false, error: "no_encontrado" };
  const usuarioId = permiso.usuario.id;

  try {
    // Un re-ruteo tiene su propia rama (Plan 5, §4): reemplaza al validado y acepta las ya asignadas no congeladas.
    if (leido.tipo === "re_ruteo") return await validarReruteo(ctx, usuarioId, leido, ids.version);
    return await ctx.bd.transaction(async (tx): Promise<Resultado<{ programadas: number; pospuestas: number }>> => {
      // Orden estable de bloqueos (Plan 4, §4).
      const fecha = leido.fecha;
      await tomarCandadoDeFecha(tx, fecha);
      await tomarCandadoDeCatalogoFlota(tx, "compartido");
      const plan = await propuestoEnVersion(tx, ids.id, ids.version);
      if (esFallo(plan)) return plan;
      await bloquearJornadasDelDia(tx, fecha);
      const jornadas = await leerJornadas(tx, fecha);
      await bloquearUnidadesYOperadores(tx, jornadas.map((j) => j.unidadId), jornadas.map((j) => j.operadorId));
      const clienteIds = [...new Set(plan.entrada.solicitudes.map((s) => s.clienteId))];
      await bloquearClientesCompartido(tx, clienteIds);
      const ruteadas = solicitudesRuteadas(plan.resultado);
      const pospuestas = plan.resultado.pospuestas.map((p) => p.solicitudId);
      // Todas las de la propuesta, también las bloqueadas por el motor: su versión también sustenta el plan.
      const bloqueadas = await bloquearSolicitudes(tx, plan.entrada.solicitudes.map((s) => s.id));
      await bloquearConfiguracionCompartido(tx);
      // La hora se toma después de los bloqueos: la espera puede haber dejado salidas en el pasado.
      const ahora = (ctx.reloj ?? (() => ctx.ahora))();

      const fallo = await comprobarValidacion(tx, plan, jornadas, clienteIds, bloqueadas, ruteadas, ahora);
      if (fallo !== null) return fallo;

      const config = await leerConfiguracionCompleta(tx);
      const unidades = new Map((await leerUnidades(tx, jornadas.map((j) => j.unidadId))).map((u) => [u.id, u]));
      await insertarRutas(tx, plan.id, rutasParaGuardar(plan, jornadas, unidades, ahora), ahora);
      await programarSolicitudes(tx, ruteadas, ahora);
      await posponerSolicitudes(tx, pospuestas, siguienteDiaOperacion(fecha, config.diasOperacion), ahora);
      await marcarValidado(tx, plan.id, usuarioId, ahora);
      await registrarEvento(tx, { usuarioId, entidad: "plan", entidadId: plan.id, accion: "validar", campos: ["estado"] });
      for (const id of ruteadas) await registrarEvento(tx, { usuarioId, entidad: "solicitud", entidadId: id, accion: "programar", campos: ["estado"] });
      for (const id of pospuestas) {
        await registrarEvento(tx, { usuarioId, entidad: "solicitud", entidadId: id, accion: "posponer", campos: ["proximaFechaElegible", "vecesPospuesta"] });
      }
      return { ok: true, valor: { programadas: ruteadas.length, pospuestas: pospuestas.length } };
    });
  } catch (error) {
    if (error instanceof ValidacionRechazada) return error.fallo;
    // Otra validación ganó la parada vigente de una solicitud entre la comprobación y la inserción: todo se revirtió.
    if (esDuplicado(error, "paradas_solicitud_vigente")) {
      return conflicto("solicitud_asignada", "Una de las solicitudes ya quedó asignada en otro plan; regenera la propuesta");
    }
    throw error;
  }
}
