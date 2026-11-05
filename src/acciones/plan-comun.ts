import type { Tx } from "@/datos/bd";
import { registrarEvento } from "@/datos/bitacora";
import { leerClientesPorId } from "@/datos/clientes";
import { leerConfiguracionCompleta, type ConfiguracionCompleta } from "@/datos/configuracion";
import { leerCatalogo, leerOperadores, leerUnidades } from "@/datos/flota";
import type { JornadaGuardada } from "@/datos/jornadas";
import {
  bloquearSolicitudes, conParadaVigente, descartarPropuesto, insertarEjecucion, insertarPlan, leerPlanParaCambiar, propuestoDeFecha,
  tomarCandadoDeFecha, type NuevaEjecucion, type NuevaPlan, type NuevaRuta, type PlanGuardado,
} from "@/datos/planes";
import { motivosDeBloqueoCliente } from "@/dominio/clientes/habilitacion";
import type { ClienteGuardado } from "@/dominio/clientes/tipos";
import { motivosNoDisponibleOperador, motivosNoDisponibleUnidad } from "@/dominio/flota/disponibilidad";
import type { OperadorGuardado, UnidadGuardada } from "@/dominio/flota/tipos";
import { capacidadMaximaPorTipo, instanteDeMinutos, minutoEnMexico, minutosDeHora } from "@/dominio/plan/entrada";
import { fechaEnMexico } from "@/dominio/tiempo";
import type { TiemposRuta } from "@/dominio/operacion/tipos";
import type { VersionesPlan } from "@/dominio/plan/tipos";
import { crearTraslados, ErrorAdmitidas, validarPlan, type EntradaPlan, type Plan, type RestriccionesPlan } from "@/motor";
import { conTraslados, matrizDeTraslados, puntosDeEntrada } from "@/traslados";
import type { CodigoConflicto, Contexto, Resultado } from "./tipos";
import { idSchema, invalido, versionSchema, type Fallo } from "./validacion";

/** Utilidades del plan del día compartidas por el plan inicial (Plan 4) y el re-ruteo (Plan 5). */

/** Una corrida más larga cuenta como tiempo agotado y su plan no se guarda (el motor es síncrono: no se interrumpe). */
export const LIMITE_MOTOR_MS = 30_000;

/**
 * Plan de seguridad (hallazgo 2): como el motor es síncrono, ocupa el proceso mientras calcula y LIMITE_MOTOR_MS no lo
 * interrumpe. Por eso se acota la entrada antes de correrlo. Medido el 2026-11-04 en contenedor: 60 solicitudes con 15
 * unidades, 0.4 s; 300 con 40, 5.7 s; 1000 con 15, 58 s; 1000 con 60, 13 min. Un día del piloto trae 50 a 60
 * solicitudes y 15 unidades. limite-motor.integracion.test.ts vigila que el tope siga muy por debajo de LIMITE_MOTOR_MS.
 */
export const MAXIMO_SOLICITUDES_MOTOR = 300;
export const MAXIMO_UNIDADES_MOTOR = 40;

/** Mensaje para la pantalla si la entrada pasa del tope del motor; null si cabe. */
export function excesoDeEntrada(entrada: Pick<EntradaPlan, "solicitudes" | "unidades">): string | null {
  const solicitudes = entrada.solicitudes.length;
  const unidades = entrada.unidades.length;
  if (solicitudes <= MAXIMO_SOLICITUDES_MOTOR && unidades <= MAXIMO_UNIDADES_MOTOR) return null;
  return `El día tiene ${solicitudes} solicitudes y ${unidades} unidades; el motor acepta hasta ${MAXIMO_SOLICITUDES_MOTOR} `
    + `solicitudes y ${MAXIMO_UNIDADES_MOTOR} unidades. Reprograma o cancela solicitudes antes de generar.`;
}

export const conflicto = (codigo: CodigoConflicto, texto: string): Fallo => ({ ok: false, error: "conflicto", motivo: { codigo, texto } });

/** Nombre y código del error, sin mensaje: nunca datos personales en la bitácora ni en ejecuciones_motor. */
export function errorSaneado(error: unknown): string {
  const nombre = error instanceof Error ? error.name : "Error";
  const codigo = (error as { code?: unknown } | null)?.code;
  return (typeof codigo === "string" ? `${nombre}:${codigo}` : nombre).slice(0, 200);
}

export const hhmmDeMinutos = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function validarIdYVersionDePlan(planId: unknown, versionEsperada: unknown): { id: string; version: number } | Fallo {
  const id = idSchema.safeParse(planId);
  if (!id.success) return { ok: false, error: "no_encontrado" };
  const version = versionSchema.safeParse(versionEsperada);
  if (!version.success) return invalido({ _: ["Falta la versión del plan"] });
  return { id: id.data, version: version.data };
}

/** El plan bloqueado, si sigue propuesto y en la versión esperada. */
export async function propuestoEnVersion(tx: Tx, id: string, version: number): Promise<PlanGuardado | Fallo> {
  const plan = await leerPlanParaCambiar(tx, id);
  if (plan === null) return { ok: false, error: "no_encontrado" };
  if (plan.estado === "validado") return conflicto("plan_validado_existente", "Este plan ya se validó");
  // Solo una propuesta se cambia: un plan descartado o reemplazado es historial.
  if (plan.estado !== "propuesto") return conflicto("generacion_adelantada", "Esta propuesta ya no está vigente; abre la del día");
  if (plan.version !== version) return { ok: false, error: "conflicto" };
  return plan;
}

/**
 * Plan 7: la matriz por calle de OSRM para la entrada, fuera de toda transacción y antes del motor. Si no la hay, el motor
 * usa la fórmula anterior; versiones.traslados dice con qué tiempos se planeó y por qué.
 */
export async function conMapa<V extends VersionesPlan>(entrada: EntradaPlan, versiones: V, config: ConfiguracionCompleta):
  Promise<{ entrada: EntradaPlan; versiones: V; consultaMapaMs: number | null }> {
  const r = await matrizDeTraslados(puntosDeEntrada(entrada), {
    url: process.env.OSRM_URL,
    factorCamion: config.factorCamion,
    respaldo: { velocidadKmh: config.velocidadKmh, factorCircuidad: config.factorCircuidad },
  });
  return { entrada: conTraslados(entrada, r), versiones: { ...versiones, traslados: r.info }, consultaMapaMs: r.consultaMs };
}

export const esFallo = (x: unknown): x is Fallo => typeof x === "object" && x !== null && "ok" in x && (x as { ok: unknown }).ok === false;

export const disponibleUnidad = (u: UnidadGuardada | undefined, catalogo: Parameters<typeof motivosNoDisponibleUnidad>[1], fecha: string) =>
  u !== undefined && motivosNoDisponibleUnidad(u, catalogo, fecha).length === 0;
export const disponibleOperador = (o: OperadorGuardado | undefined, catalogo: Parameters<typeof motivosNoDisponibleOperador>[1], fecha: string) =>
  o !== undefined && motivosNoDisponibleOperador(o, catalogo, fecha).length === 0;

export const porVersion = <T extends { id: string; version: number }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.id, x.version]));

export function mismasVersiones(guardadas: Record<string, number>, actuales: Record<string, number>): boolean {
  const a = Object.keys(guardadas);
  return a.length === Object.keys(actuales).length && a.every((id) => actuales[id] === guardadas[id]);
}

export const solicitudesRuteadas = (plan: Plan) => plan.rutas.flatMap((r) => r.viajes.flatMap((v) => v.paradas.map((p) => p.solicitudId)));

/** La ejecución sobrevive al fallo o al rechazo del guardado: va en su propia transacción, con su bitácora. */
export async function registrarEjecucionSinPlan(ctx: Contexto, e: Omit<NuevaEjecucion, "planId">): Promise<void> {
  await ctx.bd.transaction(async (tx) => {
    const id = await insertarEjecucion(tx, { ...e, planId: null });
    await registrarEvento(tx, { usuarioId: e.usuarioId, entidad: "ejecucion_motor", entidadId: id, accion: "ejecutar", campos: ["resultado"] });
  });
}

/** Error interno que revierte toda la validación; se traduce fuera de la transacción. */
export class ValidacionRechazada extends Error {
  constructor(readonly fallo: Fallo) {
    super("validación rechazada");
  }
}

/** Todas las comprobaciones de la validación, con todo ya bloqueado. null si se puede validar. */
export async function comprobarValidacion(
  tx: Tx,
  plan: PlanGuardado,
  jornadas: JornadaGuardada[],
  clienteIds: string[],
  solicitudes: Awaited<ReturnType<typeof bloquearSolicitudes>>,
  ruteadas: string[],
  ahora: Date,
  /** Reglas de estado de cada solicitud; por omisión, las del plan inicial (pendiente, elegible y sin parada vigente). */
  reglas: ReglasSolicitudes = reglasDelPlanInicial,
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
  const falloSolicitudes = await reglas(tx, plan, solicitudes, aEscribir, ruteadas);
  if (falloSolicitudes !== null) return falloSolicitudes;

  if (fecha === fechaEnMexico(ahora)) {
    const ahoraMin = minutoEnMexico(ahora);
    const salidas = plan.resultado.rutas.flatMap((r) => r.viajes.map((v) => v.salidaMin));
    if (salidas.some((m) => m < ahoraMin)) {
      return conflicto("hora_vencida", "La hora avanzó y hay salidas en el pasado: actualiza los horarios, revisa y valida");
    }
  }

  const restricciones: RestriccionesPlan | undefined = plan.restricciones ? { admitidas: plan.restricciones.admitidas } : undefined;
  const errores = validarPlan(entrada, plan.resultado, { ajustadoAMano: plan.ajustes.length > 0, restricciones });
  if (errores.length > 0) {
    console.error("[plan] la propuesta guardada no pasó la validación del motor", errores.length);
    throw new ValidacionRechazada(invalido({ _: ["La propuesta no es consistente. Regenérala; si se repite, avisa al administrador."] }));
  }
  return null;
}

/** Rutas y paradas del plan, con horas en Ciudad de México, contrafactual por solicitud y rendimiento congelado. */
export function rutasParaGuardar(
  plan: PlanGuardado,
  jornadas: JornadaGuardada[],
  unidades: Map<string, UnidadGuardada>,
  ahora: Date,
  /** Por jornada: desde cuándo está disponible el primer viaje (re-ruteo). Por omisión, disponible_desde de la jornada. */
  disponibleInicial: Map<string, Date> = new Map(),
): NuevaRuta[] {
  const { fecha, entrada } = plan;
  const p = entrada.parametros;
  const t = crearTraslados(entrada);
  const solicitudes = new Map(entrada.solicitudes.map((s) => [s.id, s]));
  const porJornada = new Map(jornadas.map((j) => [j.id, j]));
  const instante = (m: number) => instanteDeMinutos(fecha, m);
  /** Plan 7, §2.6: la submatriz dirigida entre el patio y las paradas del viaje, con el modelo con que se planeó. */
  const tiemposDelViaje = (ids: string[]): TiemposRuta => {
    const lugares = [p.patio, ...ids.map((id) => solicitudes.get(id)!.ubicacion)];
    return {
      puntos: ["patio", ...ids],
      minLibres: lugares.map((o) => lugares.map((d) => t.tramo(o, d).minLibres)),
      horasPico: p.horasPico ?? [],
      turnoFinMin: p.turnoFinMin,
      descargaMin: p.descargaMin,
    };
  };
  const nuevas: NuevaRuta[] = [];
  for (const ruta of plan.resultado.rutas) {
    const jornada = porJornada.get(ruta.unidadId)!;
    const unidad = unidades.get(jornada.unidadId)!;
    let disponible = disponibleInicial.get(jornada.id) ?? instante(minutosDeHora(jornada.disponibleDesde));
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
          // El método actual: un viaje redondo patio–cliente–patio por solicitud, en ambos sentidos (como el resumen del motor).
          kmContrafactual: t.tramo(p.patio, s.ubicacion).km + t.tramo(s.ubicacion, p.patio).km,
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
        tiempos: tiemposDelViaje(viaje.paradas.map((x) => x.solicitudId)),
        paradas,
      });
      // El siguiente viaje queda disponible al terminar la descarga de este (el Plan 5 pone el real).
      disponible = instante(viaje.finDescargaMin);
    }
  }
  return nuevas;
}


export type ReglasSolicitudes = (
  tx: Tx,
  plan: PlanGuardado,
  solicitudes: Awaited<ReturnType<typeof bloquearSolicitudes>>,
  aEscribir: Set<string>,
  ruteadas: string[],
) => Promise<Fallo | null>;

export const asignada = () => conflicto("solicitud_asignada", "Una de las solicitudes ya quedó asignada en otro plan; regenera la propuesta");
export const cambio = (texto: string) => conflicto("datos_cambiaron", `${texto} desde que se generó la propuesta; regenérala`);

/** Plan inicial: cada solicitud en su versión; las que se escriben, pendientes, elegibles y sin parada vigente. */
export const reglasDelPlanInicial: ReglasSolicitudes = async (tx, plan, solicitudes, aEscribir, ruteadas) => {
  for (const s of solicitudes) {
    if (s.version !== plan.versiones.solicitudes[s.id]) return s.estado === "programada" || s.estado === "en_ruta" ? asignada() : cambio("Cambió una solicitud");
    if (aEscribir.has(s.id) && (s.estado !== "pendiente" || s.proximaFechaElegible > plan.fecha)) return cambio("Cambió una solicitud");
  }
  if ((await conParadaVigente(tx, ruteadas)).length > 0) return asignada();
  return null;
};

export interface Generacion {
  fecha: string;
  usuarioId: string;
  entrada: EntradaPlan;
  versiones: NuevaPlan["versiones"];
  /** El propuesto vigente cuando se leyó la instantánea: si al guardar es otro, la generación quedó atrás. */
  esperado: { id: string; version: number } | null;
  correr: (entrada: EntradaPlan) => Plan;
  /** Comprobación extra con el candado de la fecha tomado (plan inicial: que no haya validado; re-ruteo: que el base siga igual). */
  antesDeGuardar: (tx: Tx) => Promise<Fallo | null>;
  reruteo?: NuevaPlan["reruteo"];
  accion: "generar" | "generar_reruteo";
  /** Plan 7: lo que tardó la consulta del mapa (K7, aparte de duracion_ms); null si no hubo consulta. */
  consultaMapaMs: number | null;
}

/**
 * Corre el motor fuera de toda transacción, medido con reloj monotónico (K7), y guarda la propuesta bajo el candado de la
 * fecha. La ejecución queda registrada aunque el motor falle, se agote el tiempo o no se pueda guardar (Plan 4, §4).
 */
export async function ejecutarYGuardar(ctx: Contexto, g: Generacion): Promise<Resultado<{ planId: string }>> {
  const exceso = excesoDeEntrada(g.entrada);
  if (exceso !== null) return invalido({ _: [exceso] });
  const inicio = performance.now();
  let plan: Plan | null = null;
  let errorMotor: string | null = null;
  let admitidasImposibles = false;
  try {
    plan = g.correr(g.entrada);
  } catch (error) {
    errorMotor = errorSaneado(error);
    admitidasImposibles = error instanceof ErrorAdmitidas;
    if (!admitidasImposibles) console.error("[plan] el motor falló", errorMotor);
  }
  const duracionMs = performance.now() - inicio;
  const ejecucion: Omit<NuevaEjecucion, "planId" | "resultado" | "error"> = {
    fecha: g.fecha, inicioEn: ctx.ahora, finEn: new Date(ctx.ahora.getTime() + duracionMs), duracionMs,
    versionMotor: plan?.versionMotor ?? "desconocida", usuarioId: g.usuarioId, consultaMapaMs: g.consultaMapaMs,
  };

  if (plan === null) {
    await registrarEjecucionSinPlan(ctx, { ...ejecucion, resultado: "error", error: errorMotor });
    return invalido({
      _: [admitidasImposibles
        ? "Lo que ya estaba asignado a las unidades disponibles no cabe con la hora actual; ajusta o pospón a mano"
        : "El motor no pudo generar el plan. Intenta de nuevo; si se repite, avisa al administrador."],
    });
  }
  if (duracionMs > LIMITE_MOTOR_MS) {
    await registrarEjecucionSinPlan(ctx, { ...ejecucion, resultado: "tiempo_agotado", error: null });
    return invalido({ _: ["El motor tardó demasiado y su resultado se descartó. Intenta de nuevo."] });
  }

  const generado = plan;
  try {
    const r = await ctx.bd.transaction(async (tx): Promise<Resultado<{ planId: string }>> => {
      await tomarCandadoDeFecha(tx, g.fecha);
      const previo = await g.antesDeGuardar(tx);
      if (previo !== null) return previo;
      const vigente = await propuestoDeFecha(tx, g.fecha);
      if ((vigente?.id ?? null) !== (g.esperado?.id ?? null) || (vigente?.version ?? null) !== (g.esperado?.version ?? null)) {
        return conflicto("generacion_adelantada", "Otra generación o un ajuste se guardó mientras el motor calculaba; revisa el plan vigente");
      }
      if (vigente !== null) {
        await descartarPropuesto(tx, vigente.id, ctx.ahora);
        await registrarEvento(tx, { usuarioId: g.usuarioId, entidad: "plan", entidadId: vigente.id, accion: "descartar_por_regeneracion", campos: ["estado"] });
      }
      const planId = await insertarPlan(tx, {
        fecha: g.fecha, generadoEn: ctx.ahora, generadoPor: g.usuarioId, semilla: g.entrada.parametros.semilla,
        versionMotor: generado.versionMotor, entrada: g.entrada, versiones: g.versiones, resultado: generado, reruteo: g.reruteo,
      });
      await insertarEjecucion(tx, { ...ejecucion, resultado: "ok", error: null, planId });
      await registrarEvento(tx, { usuarioId: g.usuarioId, entidad: "plan", entidadId: planId, accion: g.accion, campos: [] });
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
