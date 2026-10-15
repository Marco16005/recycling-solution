import { z } from "zod";
import { registrarEvento } from "@/datos/bitacora";
import { bloquearClientesCompartido, leerCartera } from "@/datos/clientes";
import { bloquearConfiguracionCompartido, leerConfiguracionCompleta } from "@/datos/configuracion";
import { bloquearUnidadesYOperadores, leerCatalogo, leerOperadores, leerUnidades } from "@/datos/flota";
import { bloquearJornadasDelDia, leerJornadas } from "@/datos/jornadas";
import { estadoDeJornada, leerJornadaOperacion, planOperativo, rutasOperativas } from "@/datos/operacion";
import {
  bloquearPlanes, bloquearSolicitudes, insertarRutas, leerPlan, marcarReemplazado, marcarValidado, posponerAsignadas, propuestoDeFecha,
  reprogramarSolicitudes, retirarParadas, subirVersionRutas, tomarCandadoDeCatalogoFlota, tomarCandadoDeFecha, type PlanGuardado,
  type RestriccionesReruteo, type VersionesReruteo,
} from "@/datos/planes";
import { leerSolicitudesParaCola, solicitudesPorId } from "@/datos/solicitudes";
import { fronteraDeReruteo } from "@/dominio/operacion";
import { construirEntrada, ErrorDeEntrada, instanteDeMinutos } from "@/dominio/plan/entrada";
import { colaDelDia, siguienteDiaOperacion } from "@/dominio/solicitudes/cola";
import { fechaEnMexico } from "@/dominio/tiempo";
import { generarPlan, type EntradaPlan } from "@/motor";
import { permitir } from "./autorizacion";
import {
  asignada, cambio, comprobarValidacion, conflicto, disponibleOperador, disponibleUnidad, ejecutarYGuardar, esFallo, porVersion,
  propuestoEnVersion, rutasParaGuardar, solicitudesRuteadas, validarIdYVersionDePlan, type ReglasSolicitudes,
} from "./plan-comun";
import type { Contexto, Resultado } from "./tipos";
import { invalido, type Fallo } from "./validacion";

/** Re-ruteo (Plan 5, §4): conserva lo congelado y las admitidas; reubica en FIFO lo de las jornadas no disponibles y lo nuevo. */

const entradaSchema = z.object({ jornadasNoDisponibles: z.array(z.uuid()).max(50) });

/** Permiso planes.generar. Solo sobre el plan validado de hoy, en su versión. */
export async function generarReruteo(ctx: Contexto, planBaseId: unknown, versionEsperada: unknown, entrada: unknown): Promise<Resultado<{ planId: string }>> {
  const permiso = permitir(ctx, "planes.generar");
  if (!permiso.ok) return permiso;
  const ids = validarIdYVersionDePlan(planBaseId, versionEsperada);
  if ("ok" in ids) return ids;
  const validado = entradaSchema.safeParse(entrada);
  if (!validado.success) return invalido({ jornadasNoDisponibles: ["Elige las jornadas que dejan de estar disponibles"] });
  const noDisponibles = new Set(validado.data.jornadasNoDisponibles);
  const usuarioId = permiso.usuario.id;
  const hoy = fechaEnMexico(ctx.ahora);

  const leida = await ctx.bd.transaction(
    async (tx) => {
      const base = await leerPlan(tx, ids.id);
      if (!base) return null;
      const jornadas = await leerJornadas(tx, base.fecha);
      const estados = new Map<string, Awaited<ReturnType<typeof estadoDeJornada>>>();
      const operacion: Record<string, number> = {};
      for (const j of jornadas) {
        const jo = await leerJornadaOperacion(tx, j.id);
        if (!jo) continue;
        estados.set(j.id, await estadoDeJornada(tx, jo));
        operacion[j.id] = jo.versionOperacion;
      }
      return {
        base, jornadas, estados, operacion,
        config: await leerConfiguracionCompleta(tx),
        cola: await leerSolicitudesParaCola(tx, base.fecha),
        cartera: await leerCartera(tx),
        unidades: await leerUnidades(tx),
        operadores: await leerOperadores(tx),
        catalogoUnidad: await leerCatalogo(tx, "unidad"),
        catalogoOperador: await leerCatalogo(tx, "operador"),
        esperado: await propuestoDeFecha(tx, base.fecha),
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  if (leida === null) return { ok: false, error: "no_encontrado" };
  const { base, jornadas, estados, config } = leida;
  if (base.estado !== "validado") return conflicto("datos_cambiaron", "Solo se re-rutea el plan validado vigente");
  if (base.version !== ids.version) return { ok: false, error: "conflicto" };
  if (base.fecha !== hoy) return invalido({ _: ["Solo se re-rutea el plan de hoy"] });
  if ([...noDisponibles].some((id) => !jornadas.some((j) => j.id === id))) return invalido({ jornadasNoDisponibles: ["Esa jornada no es de hoy"] });

  const unidades = new Map(leida.unidades.map((u) => [u.id, u]));
  const operadores = new Map(leida.operadores.map((o) => [o.id, o]));
  const clientes = new Map(leida.cartera.map((c) => [c.id, c]));
  const admitidas: Record<string, string[][]> = {};
  const congeladas: string[] = [];
  const aReubicar: string[] = [];
  const libreDesde = new Map<string, number>();
  const disponibles: typeof jornadas = [];
  for (const j of jornadas) {
    const estado = estados.get(j.id)!;
    const disponible =
      !noDisponibles.has(j.id) &&
      disponibleUnidad(unidades.get(j.unidadId), leida.catalogoUnidad, base.fecha) &&
      disponibleOperador(operadores.get(j.operadorId), leida.catalogoOperador, base.fecha);
    const frontera = fronteraDeReruteo(estado, disponible, ctx.ahora.toISOString());
    if (!frontera.ok) return invalido({ _: [frontera.motivo] });
    congeladas.push(...frontera.congeladas);
    if (disponible) {
      disponibles.push(j);
      admitidas[j.id] = frontera.admitidas;
      libreDesde.set(j.id, frontera.libreDesdeMin);
    } else {
      aReubicar.push(...frontera.aReubicar);
    }
  }

  // Lo que entra al motor: lo conservado, lo que se reubica y las listas nuevas de hoy (las programadas no salen como lista).
  const cola = colaDelDia(leida.cola, clientes, base.fecha, config.versionAvisoPrivacidad, config.diasOperacion, config.diasParaAtrasada);
  const nuevas = cola.filter((e) => e.estado === "lista").map((e) => e.solicitud.id);
  const ids2 = [...new Set([...Object.values(admitidas).flat(2), ...aReubicar, ...nuevas])];
  const solicitudes = await solicitudesPorId(ctx.bd, ids2);
  let entradaMotor: EntradaPlan;
  try {
    entradaMotor = construirEntrada({
      fecha: base.fecha,
      ahora: ctx.ahora,
      solicitudes: solicitudes.map((s) => ({ solicitud: s, cliente: clientes.get(s.clienteId)! })),
      jornadas: disponibles.map((j) => ({ jornadaId: j.id, disponibleDesde: j.disponibleDesde, unidad: unidades.get(j.unidadId)! })),
      unidadesActivas: leida.unidades.filter((u) => u.activo),
      configuracion: config,
    });
  } catch (error) {
    if (error instanceof ErrorDeEntrada) return invalido({ _: ["Revisa la ubicación del patio y la fecha del plan"] });
    throw error;
  }
  // Cada unidad vuelve a estar libre al terminar su viaje en curso (o ahora).
  entradaMotor = {
    ...entradaMotor,
    unidades: entradaMotor.unidades.map((u) => ({ ...u, libreDesdeMin: Math.max(u.libreDesdeMin, libreDesde.get(u.id) ?? 0) })),
  };

  const versiones: VersionesReruteo = {
    solicitudes: porVersion(solicitudes),
    clientes: porVersion([...new Map(solicitudes.map((s) => [s.clienteId, clientes.get(s.clienteId)!])).values()]),
    jornadas: porVersion(jornadas),
    unidades: porVersion(jornadas.map((j) => unidades.get(j.unidadId)!)),
    operadores: porVersion(jornadas.map((j) => operadores.get(j.operadorId)!)),
    configuracion: config.version,
    planBase: { id: base.id, version: base.version },
    operacion: leida.operacion,
  };
  const restricciones: RestriccionesReruteo = { jornadasNoDisponibles: [...noDisponibles], admitidas, congeladas };

  return ejecutarYGuardar(ctx, {
    fecha: base.fecha, usuarioId, entrada: entradaMotor, versiones, esperado: leida.esperado,
    correr: (e) => generarPlan(e, { admitidas }),
    antesDeGuardar: async (tx) => {
      const actual = await leerPlan(tx, base.id);
      return actual && actual.estado === "validado" && actual.version === base.version
        ? null
        : conflicto("datos_cambiaron", "El plan vigente cambió mientras se calculaba el re-ruteo; vuelve a generarlo");
    },
    reruteo: { planBaseId: base.id, restricciones },
    accion: "generar_reruteo",
  });
}

/**
 * Validación de un re-ruteo: la del Plan 4 sobre el plan operativo de la fecha, más la frescura de la operación. Las ya
 * asignadas solo se aceptan si su parada vigente está en una ruta operativa y no está congelada.
 */
export async function validarReruteo(
  ctx: Contexto,
  usuarioId: string,
  leido: PlanGuardado,
  version: number,
): Promise<Resultado<{ programadas: number; pospuestas: number }>> {
  return ctx.bd.transaction(async (tx): Promise<Resultado<{ programadas: number; pospuestas: number }>> => {
    const fecha = leido.fecha;
    await tomarCandadoDeFecha(tx, fecha);
    await tomarCandadoDeCatalogoFlota(tx, "compartido");
    const plan = await propuestoEnVersion(tx, leido.id, version);
    if (esFallo(plan)) return plan;
    const versiones = plan.versiones as VersionesReruteo;
    const restricciones = plan.restricciones!;
    const operativo = await planOperativo(tx, fecha);
    const bloqueadosPlanes = await bloquearPlanes(tx, operativo);
    const base = bloqueadosPlanes.find((p) => p.id === versiones.planBase.id);
    if (!base || base.estado !== "validado" || base.version !== versiones.planBase.version) {
      return conflicto("datos_cambiaron", "El plan vigente cambió desde que se generó el re-ruteo; vuelve a generarlo");
    }
    await bloquearJornadasDelDia(tx, fecha);
    const jornadas = await leerJornadas(tx, fecha);
    await bloquearUnidadesYOperadores(tx, jornadas.map((j) => j.unidadId), jornadas.map((j) => j.operadorId));
    const operativas = new Map<string, Awaited<ReturnType<typeof rutasOperativas>>>();
    for (const j of [...jornadas].sort((a, b) => (a.id < b.id ? -1 : 1))) operativas.set(j.id, await rutasOperativas(tx, j.id, operativo, true));
    const clienteIds = [...new Set(plan.entrada.solicitudes.map((s) => s.clienteId))];
    await bloquearClientesCompartido(tx, clienteIds);
    const ruteadas = solicitudesRuteadas(plan.resultado);
    const pospuestas = plan.resultado.pospuestas.map((p) => p.solicitudId);
    const bloqueadas = await bloquearSolicitudes(tx, plan.entrada.solicitudes.map((s) => s.id));
    await bloquearConfiguracionCompartido(tx);
    const ahora = (ctx.reloj ?? (() => ctx.ahora))();

    for (const j of jornadas) {
      const jo = await leerJornadaOperacion(tx, j.id);
      if (!jo || jo.versionOperacion !== versiones.operacion[j.id]) {
        return conflicto("operacion_avanzo", "La operación avanzó mientras se revisaba el re-ruteo (nuevos eventos o cancelaciones); vuelve a generarlo");
      }
    }

    // Parada vigente de cada solicitud en el plan operativo.
    const vigentes = new Map<string, { paradaId: string; rutaId: string }>();
    for (const rs of operativas.values()) for (const { ruta, paradas } of rs) for (const p of paradas) if (p.vigente) vigentes.set(p.solicitudId, { paradaId: p.id, rutaId: ruta.id });
    const congeladas = new Set(restricciones.congeladas);
    const reglas: ReglasSolicitudes = async (_tx, p, solicitudes, aEscribir) => {
      for (const s of solicitudes) {
        if (s.version !== p.versiones.solicitudes[s.id]) return cambio("Cambió una solicitud");
        if (!aEscribir.has(s.id)) continue;
        const vigente = vigentes.get(s.id);
        if (vigente) {
          if (congeladas.has(s.id) || (s.estado !== "programada" && s.estado !== "en_ruta")) return asignada();
        } else if (s.estado !== "pendiente" || s.proximaFechaElegible > p.fecha) {
          return cambio("Cambió una solicitud");
        }
      }
      return null;
    };
    const fallo: Fallo | null = await comprobarValidacion(tx, plan, jornadas, clienteIds, bloqueadas, ruteadas, ahora, reglas);
    if (fallo !== null) return fallo;

    // Escrituras, en el orden del Plan 5 §4: retirar, versiones de rutas, insertar, solicitudes, planes y bitácora.
    const retirarReasignadas = ruteadas.filter((s) => vigentes.has(s)).map((s) => vigentes.get(s)!);
    const retirarOmitidas = pospuestas.filter((s) => vigentes.has(s)).map((s) => vigentes.get(s)!);
    await retirarParadas(tx, retirarReasignadas.map((v) => v.paradaId), "reasignada", ahora);
    await retirarParadas(tx, retirarOmitidas.map((v) => v.paradaId), "omitida", ahora);
    await subirVersionRutas(tx, [...new Set([...retirarReasignadas, ...retirarOmitidas].map((v) => v.rutaId))], ahora);

    const config = await leerConfiguracionCompleta(tx);
    const unidades = new Map((await leerUnidades(tx, jornadas.map((j) => j.unidadId))).map((u) => [u.id, u]));
    const disponibleInicial = new Map(plan.entrada.unidades.map((u) => [u.id, instanteDeMinutos(fecha, u.libreDesdeMin)]));
    await insertarRutas(tx, plan.id, rutasParaGuardar(plan, jornadas, unidades, ahora, disponibleInicial), ahora);
    await reprogramarSolicitudes(tx, ruteadas, ahora);
    await posponerAsignadas(tx, pospuestas, siguienteDiaOperacion(fecha, config.diasOperacion), ahora);
    await marcarReemplazado(tx, base.id, ahora);
    await marcarValidado(tx, plan.id, usuarioId, ahora);
    await registrarEvento(tx, { usuarioId, entidad: "plan", entidadId: base.id, accion: "reemplazar", campos: ["estado"] });
    await registrarEvento(tx, { usuarioId, entidad: "plan", entidadId: plan.id, accion: "validar_reruteo", campos: ["estado"] });
    for (const id of ruteadas) await registrarEvento(tx, { usuarioId, entidad: "solicitud", entidadId: id, accion: "programar", campos: ["estado"] });
    for (const id of pospuestas) {
      await registrarEvento(tx, { usuarioId, entidad: "solicitud", entidadId: id, accion: "posponer", campos: ["estado", "proximaFechaElegible", "vecesPospuesta"] });
    }
    return { ok: true, valor: { programadas: ruteadas.length, pospuestas: pospuestas.length } };
  });
}
