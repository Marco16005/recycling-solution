import { permitir } from "@/acciones/autorizacion";
import type { Contexto, Resultado } from "@/acciones/tipos";
import { fechaSchema } from "@/acciones/validacion";
import { leerCartera, leerClientesPorId } from "@/datos/clientes";
import { leerConfiguracionCompleta } from "@/datos/configuracion";
import { leerCatalogo, leerOperadores, leerUnidades } from "@/datos/flota";
import { leerJornadas } from "@/datos/jornadas";
import { leerPlanVigente, ultimaEjecucion } from "@/datos/planes";
import { leerSolicitudesParaCola } from "@/datos/solicitudes";
import { requisitosPorJornada } from "@/dominio/plan/entrada";
import { colaDelDia } from "@/dominio/solicitudes/cola";
import { fechaEnMexico } from "@/dominio/tiempo";
import type { Diagnostico, MotivoBloqueoMotor, MotivoPospuesta, Plan } from "@/motor";
import { puede } from "@/seguridad/permisos";
import { resumenOperador, resumenUnidad, type OperadorResumen, type UnidadResumen } from "./flota.nucleo";
import { leerInstantanea } from "./instantanea";
import { estiloMapaUrl } from "./mapa";

/** Contrato del Plan 4, §3.3. Horas como "HH:MM" en Ciudad de México. */
export interface ParadaVista {
  solicitudId: string;
  folio: string;
  secuencia: number;
  cliente: { id: string; nombre: string; lat: number; lng: number; direccion: string | null };
  ventana: { inicio: string; fin: string };
  llegada: string;
  inicio: string;
  fin: string;
  esperaMin: number;
  cargaKg: number;
  kmDesdeAnterior: number;
}

export interface ViajeVista {
  numero: number;
  salida: string;
  regreso: string;
  finDescarga: string;
  cargaKg: number;
  capacidadKg: number;
  km: number;
  paradas: ParadaVista[];
}

export interface UnidadEnPlan { jornadaId: string; unidad: UnidadResumen; operador: OperadorResumen; viajes: ViajeVista[] }

export interface VistaPlan {
  fecha: string;
  planId: string | null;
  estado: "sin_plan" | "propuesto" | "validado";
  version: number | null;
  generadoEn: Date | null;
  revisionIniciada: boolean;
  /** Cuántos ajustes manuales tiene; 0 si es el plan del motor. */
  ajustes: number;
  patio: { lat: number; lng: number } | null;
  unidades: UnidadEnPlan[];
  pospuestas: { solicitudId: string; folio: string; cliente: string; motivo: MotivoPospuesta; diagnostico: Diagnostico | null }[];
  /** Solo bloqueos físicos del motor (carga mayor que cualquier unidad). Los clientes bloqueados no llegan al motor: están en la cola. */
  bloqueadas: { solicitudId: string; folio: string; cliente: string; motivo: MotivoBloqueoMotor }[];
  resumen: Plan["resumen"] | null;
  ultimaEjecucion: { duracionMs: number; resultado: "ok" | "error" | "tiempo_agotado"; en: Date } | null;
  /** Solicitudes listas para la fecha registradas o liberadas después de generar: invitan a regenerar. */
  nuevasDesdeGeneracion: number;
  requisitos: { jornadaId: string; operador: string; clientes: { nombre: string; tipos: string[] }[] }[];
  puedeGenerar: boolean;
  puedeValidar: boolean;
  estiloMapaUrl: string;
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Permiso planes.ver. El validado de la fecha o, si no hay, el propuesto vigente. fecha: "AAAA-MM-DD" o undefined para hoy. */
export async function obtenerPlan(ctx: Contexto, fecha: unknown): Promise<Resultado<VistaPlan>> {
  const permiso = permitir(ctx, "planes.ver");
  if (!permiso.ok) return permiso;
  const dia = fecha === undefined ? fechaEnMexico(ctx.ahora) : fechaSchema.safeParse(fecha).data;
  if (dia === undefined) return { ok: false, error: "invalido", campos: { fecha: ["Fecha no válida"] } };

  const datos = await leerInstantanea(ctx.bd, async (tx) => {
    const plan = await leerPlanVigente(tx, dia);
    const clienteIds = plan ? [...new Set(plan.entrada.solicitudes.map((s) => s.clienteId))] : [];
    return {
      plan,
      config: await leerConfiguracionCompleta(tx),
      ejecucion: await ultimaEjecucion(tx, dia),
      jornadas: await leerJornadas(tx, dia),
      unidades: await leerUnidades(tx),
      operadores: await leerOperadores(tx),
      clientes: await leerClientesPorId(tx, clienteIds),
      catalogoCliente: await leerCatalogo(tx, "cliente"),
      // Para contar las solicitudes listas que no entraron a la propuesta.
      solicitudes: plan?.estado === "propuesto" ? await leerSolicitudesParaCola(tx, dia) : [],
      cartera: plan?.estado === "propuesto" ? await leerCartera(tx) : [],
    };
  });

  const { plan, config } = datos;
  // Con plan, el patio y las ubicaciones son los de su instantánea: kilómetros y horas se calcularon con ellos.
  const patio = plan
    ? plan.entrada.parametros.patio
    : config.patioLat !== null && config.patioLng !== null ? { lat: config.patioLat, lng: config.patioLng } : null;
  const puedeGenerar = puede(permiso.usuario, "planes.generar");
  const base = {
    fecha: dia, patio, estiloMapaUrl: estiloMapaUrl(), puedeGenerar,
    ultimaEjecucion: datos.ejecucion,
  };
  if (plan === null) {
    return {
      ok: true,
      valor: {
        ...base, planId: null, estado: "sin_plan", version: null, generadoEn: null, revisionIniciada: false, ajustes: 0,
        unidades: [], pospuestas: [], bloqueadas: [], resumen: null, nuevasDesdeGeneracion: 0, requisitos: [], puedeValidar: false,
      },
    };
  }

  const solicitudes = new Map(plan.entrada.solicitudes.map((s) => [s.id, s]));
  const clientes = new Map(datos.clientes.map((c) => [c.id, c]));
  const unidades = new Map(datos.unidades.map((u) => [u.id, u]));
  const operadores = new Map(datos.operadores.map((o) => [o.id, o]));
  const jornadas = new Map(datos.jornadas.map((j) => [j.id, j]));
  const capacidad = new Map(plan.entrada.unidades.map((u) => [u.id, u.capacidadKg]));
  const clienteDe = (solicitudId: string) => clientes.get(solicitudes.get(solicitudId)!.clienteId)!;
  const nombreCliente = (solicitudId: string) => clienteDe(solicitudId).nombre;
  const folio = (solicitudId: string) => solicitudes.get(solicitudId)!.folio;

  // Una jornada quitada después de generar ya no se muestra; validar responderá datos_cambiaron.
  const enPlan = plan.resultado.rutas.filter((r) => jornadas.has(r.unidadId));
  const vistaUnidades: UnidadEnPlan[] = enPlan.map((ruta) => {
    const jornada = jornadas.get(ruta.unidadId)!;
    return {
      jornadaId: jornada.id,
      unidad: resumenUnidad(unidades.get(jornada.unidadId)!),
      operador: resumenOperador(operadores.get(jornada.operadorId)!),
      viajes: ruta.viajes.map((v) => ({
        numero: v.numero, salida: hhmm(v.salidaMin), regreso: hhmm(v.regresoPatioMin), finDescarga: hhmm(v.finDescargaMin),
        cargaKg: v.cargaKg, capacidadKg: capacidad.get(ruta.unidadId) ?? 0, km: v.km,
        paradas: v.paradas.map((p) => {
          const c = clienteDe(p.solicitudId);
          const { ubicacion } = solicitudes.get(p.solicitudId)!;
          return {
            solicitudId: p.solicitudId, folio: folio(p.solicitudId), secuencia: p.secuencia,
            cliente: { id: c.id, nombre: c.nombre, lat: ubicacion.lat, lng: ubicacion.lng, direccion: c.direccion },
            ventana: { inicio: hhmm(p.ventana.inicioMin), fin: hhmm(p.ventana.finMin) },
            llegada: hhmm(p.llegadaMin), inicio: hhmm(p.inicioServicioMin), fin: hhmm(p.finServicioMin),
            esperaMin: p.esperaMin, cargaKg: solicitudes.get(p.solicitudId)!.cargaKg, kmDesdeAnterior: p.kmDesdeAnterior,
          };
        }),
      })),
    };
  });

  const nombreTipo = new Map(datos.catalogoCliente.map((t) => [t.id, t.nombre]));
  const clientesPorSolicitud = new Map(plan.entrada.solicitudes.map((s) => [s.id, clientes.get(s.clienteId)!]));
  const requisitos = [...requisitosPorJornada(plan.resultado, clientesPorSolicitud).entries()]
    .filter(([jornadaId, lista]) => jornadas.has(jornadaId) && lista.length > 0)
    .map(([jornadaId, lista]) => ({
      jornadaId,
      operador: operadores.get(jornadas.get(jornadaId)!.operadorId)!.nombre,
      clientes: lista.map((c) => ({ nombre: c.nombre, tipos: c.tipos.map((t) => nombreTipo.get(t) ?? t) })),
    }));

  let nuevasDesdeGeneracion = 0;
  if (plan.estado === "propuesto") {
    const cartera = new Map(datos.cartera.map((c) => [c.id, c]));
    const cola = colaDelDia(datos.solicitudes, cartera, dia, config.versionAvisoPrivacidad, config.diasOperacion, config.diasParaAtrasada);
    nuevasDesdeGeneracion = cola.filter((e) => e.estado === "lista" && !solicitudes.has(e.solicitud.id)).length;
  }

  return {
    ok: true,
    valor: {
      ...base,
      planId: plan.id, estado: plan.estado === "validado" ? "validado" : "propuesto", version: plan.version, generadoEn: plan.generadoEn,
      revisionIniciada: plan.revisionIniciadaEn !== null, ajustes: plan.ajustes.length,
      unidades: vistaUnidades,
      pospuestas: plan.resultado.pospuestas.map((p) => ({
        solicitudId: p.solicitudId, folio: folio(p.solicitudId), cliente: nombreCliente(p.solicitudId), motivo: p.motivo, diagnostico: p.diagnostico,
      })),
      bloqueadas: plan.resultado.bloqueadas.map((b) => ({
        solicitudId: b.solicitudId, folio: folio(b.solicitudId), cliente: nombreCliente(b.solicitudId), motivo: b.motivo,
      })),
      resumen: plan.resultado.resumen,
      nuevasDesdeGeneracion,
      requisitos,
      puedeValidar: plan.estado === "propuesto" && puede(permiso.usuario, "planes.validar"),
    },
  };
}
