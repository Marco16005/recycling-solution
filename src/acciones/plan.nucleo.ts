import { z } from "zod";
import type { Tx } from "@/datos/bd";
import { registrarEvento } from "@/datos/bitacora";
import { bloquearClientesCompartido, leerCartera, leerClientesPorId } from "@/datos/clientes";
import { bloquearConfiguracionCompartido, leerConfiguracionCompleta, type ConfiguracionCompleta } from "@/datos/configuracion";
import { bloquearUnidadesYOperadores, leerCatalogo, leerOperadores, leerUnidades } from "@/datos/flota";
import { bloquearJornadasDelDia, leerJornadas, type JornadaGuardada } from "@/datos/jornadas";
import {
  bloquearSolicitudes, conParadaVigente, descartarPropuesto, fijarRevisionIniciada, guardarAjuste, hayValidado, insertarEjecucion,
  insertarPlan, insertarRutas, leerPlan, leerPlanParaCambiar, marcarDescartado, marcarValidado, posponerSolicitudes,
  programarSolicitudes, propuestoDeFecha, tomarCandadoDeCatalogoFlota, tomarCandadoDeFecha, type NuevaEjecucion, type NuevaRuta,
  type PlanGuardado,
} from "@/datos/planes";
import { leerSolicitudesParaCola } from "@/datos/solicitudes";
import { diaSemanaDeFecha, motivosDeBloqueoCliente } from "@/dominio/clientes/habilitacion";
import type { ClienteGuardado } from "@/dominio/clientes/tipos";
import { motivosNoDisponibleOperador, motivosNoDisponibleUnidad } from "@/dominio/flota/disponibilidad";
import type { OperadorGuardado, UnidadGuardada } from "@/dominio/flota/tipos";
import {
  capacidadMaximaPorTipo, construirEntrada, ErrorDeEntrada, instanteDeMinutos, MARGEN_REVISION_MIN, minutoEnMexico, minutosDeHora,
} from "@/dominio/plan/entrada";
import type { VersionesPlan } from "@/dominio/plan/tipos";
import { colaDelDia, siguienteDiaOperacion } from "@/dominio/solicitudes/cola";
import { fechaEnMexico } from "@/dominio/tiempo";
import { ajustarPlan, distanciaKm, generarPlan, validarPlan, type AjusteManual, type EntradaPlan, type Plan, type ResultadoAjuste } from "@/motor";
import { permitir } from "./autorizacion";
import type { CodigoConflicto, Contexto, Resultado } from "./tipos";
import { esDuplicado, fechaSchema, idSchema, invalido, versionSchema, type Fallo } from "./validacion";

/**
 * Plan del día (Plan 4, §3.3 y §4). Generar, iniciar la revisión, ajustar y descartar: permiso planes.generar;
 * validar: planes.validar. Los conflictos llevan su motivo (CodigoConflicto).
 */

/** Una corrida más larga cuenta como tiempo agotado y su plan no se guarda (el motor es síncrono: no se interrumpe). */
export const LIMITE_MOTOR_MS = 30_000;

const conflicto = (codigo: CodigoConflicto, texto: string): Fallo => ({ ok: false, error: "conflicto", motivo: { codigo, texto } });

/** Nombre y código del error, sin mensaje: nunca datos personales en la bitácora ni en ejecuciones_motor. */
function errorSaneado(error: unknown): string {
  const nombre = error instanceof Error ? error.name : "Error";
  const codigo = (error as { code?: unknown } | null)?.code;
  return (typeof codigo === "string" ? `${nombre}:${codigo}` : nombre).slice(0, 200);
}

const hhmmDeMinutos = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function validarIdYVersionDePlan(planId: unknown, versionEsperada: unknown): { id: string; version: number } | Fallo {
  const id = idSchema.safeParse(planId);
  if (!id.success) return { ok: false, error: "no_encontrado" };
  const version = versionSchema.safeParse(versionEsperada);
  if (!version.success) return invalido({ _: ["Falta la versión del plan"] });
  return { id: id.data, version: version.data };
}

/** El plan bloqueado, si sigue propuesto y en la versión esperada. */
async function propuestoEnVersion(tx: Tx, id: string, version: number): Promise<PlanGuardado | Fallo> {
  const plan = await leerPlanParaCambiar(tx, id);
  if (plan === null) return { ok: false, error: "no_encontrado" };
  if (plan.estado === "validado") return conflicto("plan_validado_existente", "Este plan ya se validó");
  if (plan.estado === "descartado") return conflicto("generacion_adelantada", "Esta propuesta se descartó; abre la vigente");
  if (plan.version !== version) return { ok: false, error: "conflicto" };
  return plan;
}

const esFallo = (x: unknown): x is Fallo => typeof x === "object" && x !== null && "ok" in x && (x as { ok: unknown }).ok === false;

const disponibleUnidad = (u: UnidadGuardada | undefined, catalogo: Parameters<typeof motivosNoDisponibleUnidad>[1], fecha: string) =>
  u !== undefined && motivosNoDisponibleUnidad(u, catalogo, fecha).length === 0;
const disponibleOperador = (o: OperadorGuardado | undefined, catalogo: Parameters<typeof motivosNoDisponibleOperador>[1], fecha: string) =>
  o !== undefined && motivosNoDisponibleOperador(o, catalogo, fecha).length === 0;

const porVersion = <T extends { id: string; version: number }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.id, x.version]));

function mismasVersiones(guardadas: Record<string, number>, actuales: Record<string, number>): boolean {
  const a = Object.keys(guardadas);
  return a.length === Object.keys(actuales).length && a.every((id) => actuales[id] === guardadas[id]);
}

const solicitudesRuteadas = (plan: Plan) => plan.rutas.flatMap((r) => r.viajes.flatMap((v) => v.paradas.map((p) => p.solicitudId)));

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

  // El motor corre fuera de toda transacción; el tiempo se mide aquí, con reloj monotónico (K7).
  const inicio = performance.now();
  let plan: Plan | null = null;
  let errorMotor: string | null = null;
  try {
    plan = generarPlan(entrada);
  } catch (error) {
    errorMotor = errorSaneado(error);
    console.error("[plan] el motor falló", errorMotor);
  }
  const duracionMs = performance.now() - inicio;
  const ejecucion: Omit<NuevaEjecucion, "planId" | "resultado" | "error"> = {
    fecha: dia.data,
    inicioEn: ctx.ahora,
    finEn: new Date(ctx.ahora.getTime() + duracionMs),
    duracionMs,
    versionMotor: plan?.versionMotor ?? "desconocida",
    usuarioId,
  };

  if (plan === null) {
    await registrarEjecucionSinPlan(ctx, { ...ejecucion, resultado: "error", error: errorMotor });
    return invalido({ _: ["El motor no pudo generar el plan. Intenta de nuevo; si se repite, avisa al administrador."] });
  }
  if (duracionMs > LIMITE_MOTOR_MS) {
    await registrarEjecucionSinPlan(ctx, { ...ejecucion, resultado: "tiempo_agotado", error: null });
    return invalido({ _: ["El motor tardó demasiado y su resultado se descartó. Intenta de nuevo."] });
  }

  const generado = plan;
  try {
    const r = await ctx.bd.transaction(async (tx): Promise<Resultado<{ planId: string }>> => {
      await tomarCandadoDeFecha(tx, dia.data);
      if (await hayValidado(tx, dia.data)) {
        return conflicto("plan_validado_existente", "La fecha ya tiene un plan validado; los cambios del día se hacen con el re-ruteo");
      }
      const vigente = await propuestoDeFecha(tx, dia.data);
      if ((vigente?.id ?? null) !== (esperado?.id ?? null) || (vigente?.version ?? null) !== (esperado?.version ?? null)) {
        return conflicto("generacion_adelantada", "Otra generación o un ajuste se guardó mientras el motor calculaba; revisa el plan vigente");
      }
      if (vigente !== null) {
        await descartarPropuesto(tx, vigente.id, ctx.ahora);
        await registrarEvento(tx, { usuarioId, entidad: "plan", entidadId: vigente.id, accion: "descartar_por_regeneracion", campos: ["estado"] });
      }
      const planId = await insertarPlan(tx, {
        fecha: dia.data, generadoEn: ctx.ahora, generadoPor: usuarioId, semilla: entrada.parametros.semilla,
        versionMotor: generado.versionMotor, entrada, versiones, resultado: generado,
      });
      await insertarEjecucion(tx, { ...ejecucion, resultado: "ok", error: null, planId });
      await registrarEvento(tx, { usuarioId, entidad: "plan", entidadId: planId, accion: "generar", campos: [] });
      return { ok: true, valor: { planId } };
    });
    if (!r.ok) await registrarEjecucionSinPlan(ctx, { ...ejecucion, resultado: "ok", error: null });
    return r;
  } catch (error) {
    const saneado = errorSaneado(error);
    console.error("[plan] no se pudo guardar la propuesta", saneado);
    await registrarEjecucionSinPlan(ctx, { ...ejecucion, resultado: "ok", error: `guardado:${saneado}`.slice(0, 200) });
    return invalido({ _: ["No se pudo guardar el plan. Intenta de nuevo; si se repite, avisa al administrador."] });
  }
}

/** La ejecución sobrevive al fallo o al rechazo del guardado: va en su propia transacción, con su bitácora. */
async function registrarEjecucionSinPlan(ctx: Contexto, e: Omit<NuevaEjecucion, "planId">): Promise<void> {
  await ctx.bd.transaction(async (tx) => {
    const id = await insertarEjecucion(tx, { ...e, planId: null });
    await registrarEvento(tx, { usuarioId: e.usuarioId, entidad: "ejecucion_motor", entidadId: id, accion: "ejecutar", campos: ["resultado"] });
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

/** Error interno que revierte toda la validación; se traduce fuera de la transacción. */
class ValidacionRechazada extends Error {
  constructor(readonly fallo: Fallo) {
    super("validación rechazada");
  }
}

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

/** Todas las comprobaciones de la validación, con todo ya bloqueado. null si se puede validar. */
async function comprobarValidacion(
  tx: Tx,
  plan: PlanGuardado,
  jornadas: JornadaGuardada[],
  clienteIds: string[],
  solicitudes: Awaited<ReturnType<typeof bloquearSolicitudes>>,
  ruteadas: string[],
  ahora: Date,
): Promise<Fallo | null> {
  const { fecha, entrada, versiones } = plan;
  if (plan.revisionIniciadaEn === null) return invalido({ _: ["Abre el plan para revisarlo antes de validar"] });
  if (fecha < fechaEnMexico(ahora)) return invalido({ _: ["La fecha del plan ya pasó"] });

  const cambiaron = (texto: string) => conflicto("datos_cambiaron", `${texto} desde que se generó la propuesta; regenérala`);
  if (!mismasVersiones(versiones.jornadas, porVersion(jornadas))) return cambiaron("Cambiaron las jornadas del día");

  const unidades = await leerUnidades(tx, jornadas.map((j) => j.unidadId));
  const operadores = await leerOperadores(tx, jornadas.map((j) => j.operadorId));
  if (!mismasVersiones(versiones.unidades, porVersion(unidades)) || !mismasVersiones(versiones.operadores, porVersion(operadores))) {
    return cambiaron("Cambiaron unidades u operadores del día");
  }
  const enUso = new Set(entrada.unidades.map((u) => u.id));
  const catalogoUnidad = await leerCatalogo(tx, "unidad");
  const catalogoOperador = await leerCatalogo(tx, "operador");
  const porUnidad = new Map(unidades.map((u) => [u.id, u]));
  const porOperador = new Map(operadores.map((o) => [o.id, o]));
  for (const j of jornadas.filter((j) => enUso.has(j.id))) {
    if (!disponibleUnidad(porUnidad.get(j.unidadId), catalogoUnidad, fecha) || !disponibleOperador(porOperador.get(j.operadorId), catalogoOperador, fecha)) {
      return cambiaron("Una unidad u operador del plan dejó de estar disponible");
    }
  }

  const config = await leerConfiguracionCompleta(tx);
  if (config.version !== versiones.configuracion) return cambiaron("Cambió la configuración");
  const clientes = await leerClientesPorId(tx, clienteIds);
  if (!mismasVersiones(versiones.clientes, porVersion(clientes))) return cambiaron("Cambiaron datos de clientes");
  const clienteDe = new Map(entrada.solicitudes.map((s) => [s.id, s.clienteId]));
  const porCliente = new Map<string, ClienteGuardado>(clientes.map((c) => [c.id, c]));
  const aEscribir = new Set([...ruteadas, ...plan.resultado.pospuestas.map((p) => p.solicitudId)]);
  // Ruteadas y pospuestas: posponer la de un cliente que ya no está habilitado también sería escribir sobre datos viejos.
  for (const id of new Set([...aEscribir].map((s) => clienteDe.get(s)!))) {
    const cliente = porCliente.get(id);
    if (!cliente || motivosDeBloqueoCliente(cliente, fecha, config.versionAvisoPrivacidad).length > 0) {
      return conflicto("cliente_no_habilitado", `${cliente?.nombre ?? "Un cliente"} ya no se puede programar (por ejemplo, retiró su consentimiento); regenera la propuesta`);
    }
  }

  const activas = await leerUnidades(tx);
  const maximas = capacidadMaximaPorTipo(activas.filter((u) => u.activo));
  const guardadas = entrada.parametros.capacidadMaximaPorTipoKg;
  if (Object.keys(guardadas).some((t) => maximas[t as keyof typeof maximas] !== guardadas[t as keyof typeof guardadas])) {
    return conflicto("capacidades_cambiaron", "Cambió la capacidad de la flota desde que se generó la propuesta; regenérala");
  }

  if (solicitudes.length !== entrada.solicitudes.length) return cambiaron("Una solicitud ya no existe");
  for (const s of solicitudes) {
    if (s.version !== versiones.solicitudes[s.id]) {
      return s.estado === "programada" || s.estado === "en_ruta"
        ? conflicto("solicitud_asignada", "Una de las solicitudes ya quedó asignada en otro plan; regenera la propuesta")
        : cambiaron("Cambió una solicitud");
    }
    if (aEscribir.has(s.id) && (s.estado !== "pendiente" || s.proximaFechaElegible > fecha)) return cambiaron("Cambió una solicitud");
  }
  if ((await conParadaVigente(tx, ruteadas)).length > 0) {
    return conflicto("solicitud_asignada", "Una de las solicitudes ya quedó asignada en otro plan; regenera la propuesta");
  }

  if (fecha === fechaEnMexico(ahora)) {
    const ahoraMin = minutoEnMexico(ahora);
    const salidas = plan.resultado.rutas.flatMap((r) => r.viajes.map((v) => v.salidaMin));
    if (salidas.some((m) => m < ahoraMin)) {
      return conflicto("hora_vencida", "La hora avanzó y hay salidas en el pasado: actualiza los horarios, revisa y valida");
    }
  }

  const errores = validarPlan(entrada, plan.resultado, { ajustadoAMano: plan.ajustes.length > 0 });
  if (errores.length > 0) {
    console.error("[plan] la propuesta guardada no pasó la validación del motor", errores.length);
    throw new ValidacionRechazada(invalido({ _: ["La propuesta no es consistente. Regenérala; si se repite, avisa al administrador."] }));
  }
  return null;
}

/** Rutas y paradas del plan, con horas en Ciudad de México, contrafactual por solicitud y rendimiento congelado. */
function rutasParaGuardar(plan: PlanGuardado, jornadas: JornadaGuardada[], unidades: Map<string, UnidadGuardada>, ahora: Date): NuevaRuta[] {
  const { fecha, entrada } = plan;
  const p = entrada.parametros;
  const solicitudes = new Map(entrada.solicitudes.map((s) => [s.id, s]));
  const porJornada = new Map(jornadas.map((j) => [j.id, j]));
  const instante = (m: number) => instanteDeMinutos(fecha, m);
  const nuevas: NuevaRuta[] = [];
  for (const ruta of plan.resultado.rutas) {
    const jornada = porJornada.get(ruta.unidadId)!;
    const unidad = unidades.get(jornada.unidadId)!;
    let disponible = instante(minutosDeHora(jornada.disponibleDesde));
    for (const viaje of ruta.viajes) {
      const paradas = viaje.paradas.map((parada) => {
        const s = solicitudes.get(parada.solicitudId)!;
        return {
          solicitudId: parada.solicitudId,
          secuencia: parada.secuencia,
          ventanaInicio: hhmmDeMinutos(parada.ventana.inicioMin),
          ventanaFin: hhmmDeMinutos(parada.ventana.finMin),
          llegadaEstimada: instante(parada.llegadaMin),
          inicioEstimado: instante(parada.inicioServicioMin),
          finEstimado: instante(parada.finServicioMin),
          esperaMin: parada.esperaMin,
          cargaKg: s.cargaKg,
          kmDesdeAnterior: parada.kmDesdeAnterior,
          // El método actual: un viaje redondo patio–cliente–patio por solicitud (como el resumen del motor).
          kmContrafactual: 2 * distanciaKm(p.patio, s.ubicacion, p.factorCircuidad),
        };
      });
      nuevas.push({
        jornadaId: jornada.id,
        numeroViaje: viaje.numero,
        salidaEstimada: instante(viaje.salidaMin),
        regresoEstimado: instante(viaje.regresoPatioMin),
        finDescargaEstimado: instante(viaje.finDescargaMin),
        cargaKg: viaje.cargaKg,
        kmEstimados: viaje.km,
        kmContrafactual: paradas.reduce((suma, x) => suma + x.kmContrafactual, 0),
        rendimientoKmLUsado: unidad.rendimientoKmL,
        disponibleParaSalirEn: disponible,
        asignadaEn: ahora,
        paradas,
      });
      // El siguiente viaje queda disponible al terminar la descarga de este (el Plan 5 pone el real).
      disponible = instante(viaje.finDescargaMin);
    }
  }
  return nuevas;
}

