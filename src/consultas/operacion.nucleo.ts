import { permitir } from "@/acciones/autorizacion";
import type { Contexto, Resultado } from "@/acciones/tipos";
import { fechaSchema } from "@/acciones/validacion";
import { leerClientesPorId } from "@/datos/clientes";
import { leerConfiguracionCompleta } from "@/datos/configuracion";
import { leerCatalogo, leerOperadores, leerUnidades } from "@/datos/flota";
import { solicitudesPorId } from "@/datos/solicitudes";
import { disponibleOperador, disponibleUnidad } from "@/acciones/plan-comun";
import { minutoEnMexico, minutosDeHora } from "@/dominio/plan/entrada";
import { leerJornadas } from "@/datos/jornadas";
import {
  estadoDeJornada, eventosRechazadosSinConciliar, incidentesAbiertos, leerJornadaOperacion, motivosNoAtendidas, omitidasFueraDeSecuencia, ultimoEventoAplicado,
} from "@/datos/operacion";
import {
  proyectarJornada, siguienteAccion, type AlertaOperacion, type EstadoJornada, type ProyeccionJornada, type TipoAlerta, type TipoEvento,
} from "@/dominio/operacion";
import { fechaEnMexico } from "@/dominio/tiempo";
import { puede } from "@/seguridad/permisos";
import { leerInstantanea } from "./instantanea";

/** Contrato del Plan 5, §3.3: avance de cada jornada del día, incidentes abiertos y eventos rechazados por conciliar. */
export interface SeguimientoJornada {
  jornadaId: string; operador: string; placa: string;
  avance: { completadas: number; noAtendidas: number; pendientes: number; enSitio: number };
  ultimoEvento: { tipo: string; en: Date } | null;
  checkIn: boolean; checkOut: boolean;
  /** Plan 7: horas proyectadas y alertas de la jornada. */
  proyeccion: { paradas: ParadaEnSeguimiento[]; alertas: AlertaOperacion[]; aproximada: boolean };
  /** Tablero del día (diseño del 2026-11-21): qué hace el camión, sus viajes y recolecciones, y el siguiente paso. */
  tablero: TableroJornada;
}

/** Diseño del 2026-11-21 (tablero del día), §3. Horas HH:MM en Ciudad de México. */
export type EstadoViajeTablero = "en_espera" | "en_camino" | "descargando" | "terminado";
export type EstadoParadaTablero = "pendiente" | "en_camino" | "en_cliente" | "recolectando" | "recolectada" | "no_atendida" | "reasignada" | "omitida";
export interface ParadaTablero {
  paradaId: string; folio: string; cliente: string; estado: EstadoParadaTablero; etiqueta: string;
  /** La hora en que se recolectó o se cerró; la llegada proyectada si está pendiente; null si no aplica. */
  hora: string | null;
  /** Pendiente o en camino: la llegada que estimó el plan, para ver el retraso contra la proyectada; si no, null. */
  horaPlan: string | null;
  ventana: { inicio: string; fin: string };
  motivo: string | null;
}
export interface ViajeTablero {
  rutaId: string; numero: number; estado: EstadoViajeTablero; etiqueta: string;
  salida: string | null; regreso: string | null; paradas: ParadaTablero[];
}
export interface SiguientePaso {
  tipo: TipoEvento; texto: string; rutaId: string | null; paradaId: string | null; versionRuta: number | null;
  pideOdometro: boolean; permiteNoAtendida: boolean;
  /** La hora mínima que se puede marcar (la del último evento), o null. */
  desde: string | null;
}
export interface TableroJornada {
  frase: string;
  recolecciones: { hechas: number; total: number };
  viajes: ViajeTablero[];
  /** null si la jornada terminó o si quien consulta no puede registrar. */
  siguiente: SiguientePaso | null;
  /** Pospuestas por un re-ruteo en viajes que se quedaron sin paradas antes de salir: ya no se harán ese día. */
  omitidas: { paradaId: string; folio: string; cliente: string }[];
}
/** Plan 7, §2.5. Horas HH:MM en Ciudad de México. */
export interface ParadaEnSeguimiento {
  paradaId: string; solicitudId: string; folio: string; cliente: string;
  ventana: { inicio: string; fin: string };
  llegadaEstimada: string; llegadaProyectada: string;
  enViajeEnCurso: boolean; liberable: boolean; ubicacionSupuesta: boolean;
}
export interface VistaSeguimiento {
  fecha: string;
  porJornada: SeguimientoJornada[];
  incidentesAbiertos: { id: string; version: number; jornadaId: string; paradaId: string | null; tipo: string; descripcion: string; reportadoEn: Date }[];
  eventosRechazados: { eventoId: string; jornadaId: string; tipo: string; ocurridoEn: Date; motivoRechazo: string | null }[];
  puedeResolver: boolean;
  puedeConciliar: boolean;
  /** Tablero del día: el despacho puede marcar el avance por el operador (operacion.registrar). */
  puedeRegistrar: boolean;
  /** Plan 7: cuántas alertas hay de cada tipo en el día. */
  resumenAlertas: Record<TipoAlerta, number>;
}

/** Permiso operacion.ver. fecha: "AAAA-MM-DD" o undefined para hoy. */
export async function seguimiento(ctx: Contexto, fecha?: unknown): Promise<Resultado<VistaSeguimiento>> {
  const permiso = permitir(ctx, "operacion.ver");
  if (!permiso.ok) return permiso;
  const dia = fecha === undefined ? fechaEnMexico(ctx.ahora) : fechaSchema.safeParse(fecha).data;
  if (dia === undefined) return { ok: false, error: "invalido", campos: { fecha: ["Fecha no válida"] } };

  return leerInstantanea(ctx.bd, async (tx): Promise<Resultado<VistaSeguimiento>> => {
    const jornadas = await leerJornadas(tx, dia);
    const unidades = new Map((await leerUnidades(tx, jornadas.map((j) => j.unidadId))).map((u) => [u.id, u]));
    const operadores = new Map((await leerOperadores(tx, jornadas.map((j) => j.operadorId))).map((o) => [o.id, o]));
    const config = await leerConfiguracionCompleta(tx);
    const catalogoUnidad = await leerCatalogo(tx, "unidad");
    const catalogoOperador = await leerCatalogo(tx, "operador");
    const opciones = { ahora: ctx.ahora.toISOString(), umbralAtrasoMin: config.umbralAtrasoMin, turnoFinMin: minutosDeHora(config.turnoFin), descargaMin: config.descargaMin };
    const leidos: { j: (typeof jornadas)[number]; estado: EstadoJornada; proyeccion: ProyeccionJornada; omitidas: { paradaId: string; solicitudId: string }[] }[] = [];
    for (const j of jornadas) {
      const operacion = await leerJornadaOperacion(tx, j.id);
      if (!operacion) continue;
      const estado = await estadoDeJornada(tx, operacion);
      leidos.push({ j, estado, proyeccion: proyectarConRespaldo(estado, opciones), omitidas: await omitidasFueraDeSecuencia(tx, operacion) });
    }
    // Folio y cliente de las paradas proyectadas, en una sola lectura.
    const ids = [...new Set(leidos.flatMap(({ estado, omitidas }) => [
      ...estado.viajes.flatMap((v) => v.paradas.map((p) => p.solicitudId)), ...omitidas.map((o) => o.solicitudId),
    ]))];
    const solicitudes = new Map((await solicitudesPorId(tx, ids)).map((s) => [s.id, s]));
    const clientes = new Map((await leerClientesPorId(tx, [...new Set([...solicitudes.values()].map((s) => s.clienteId))])).map((c) => [c.id, c]));
    const resumenAlertas: Record<TipoAlerta, number> = { ventana_en_riesgo: 0, fuera_de_turno: 0, atraso: 0 };
    const puedeRegistrar = puede(permiso.usuario, "operacion.registrar");
    // Solicitudes activas hoy en cualquier camión: una pospuesta que se reprogramó y volvió a un viaje no es «pospuesta».
    const activasHoy = new Set(leidos.flatMap(({ estado }) => estado.viajes.flatMap((v) =>
      v.paradas.filter((p) => p.estado !== "reasignada" && p.estado !== "omitida").map((p) => p.solicitudId))));
    const motivos = await motivosNoAtendidas(tx, leidos.flatMap(({ estado }) => estado.viajes.flatMap((v) => v.paradas.map((p) => p.paradaId))));

    const porJornada: SeguimientoJornada[] = [];
    for (const { j, estado, proyeccion, omitidas } of leidos) {
      const paradas = estado.viajes.flatMap((v) => v.paradas);
      const ultimo = await ultimoEventoAplicado(tx, j.id);
      porJornada.push({
        jornadaId: j.id,
        operador: operadores.get(j.operadorId)?.nombre ?? "",
        placa: unidades.get(j.unidadId)?.placa ?? "",
        avance: {
          completadas: paradas.filter((p) => p.estado === "completada").length,
          noAtendidas: paradas.filter((p) => p.estado === "no_atendida").length,
          pendientes: paradas.filter((p) => p.vigente && p.estado === "pendiente").length,
          enSitio: paradas.filter((p) => p.estado === "en_sitio" || p.estado === "en_servicio").length,
        },
        ultimoEvento: ultimo,
        checkIn: estado.checkInEn !== null,
        checkOut: estado.checkOutEn !== null,
        proyeccion: {
          paradas: paradasEnSeguimiento(estado, proyeccion, {
            // Mismos criterios que generarReruteo para liberar (Plan 7, §4 del plan, hallazgo 5).
            disponible: estado.checkOutEn === null
              && disponibleUnidad(unidades.get(j.unidadId), catalogoUnidad, dia)
              && disponibleOperador(operadores.get(j.operadorId), catalogoOperador, dia),
            folio: (id) => solicitudes.get(id)?.folio ?? "",
            cliente: (id) => clientes.get(solicitudes.get(id)?.clienteId ?? "")?.nombre ?? "",
          }),
          alertas: proyeccion.alertas,
          aproximada: proyeccion.viajes.some((v) => v.aproximada),
        },
        tablero: tableroDeJornada(estado, proyeccion, {
          folio: (id) => solicitudes.get(id)?.folio ?? "",
          cliente: (id) => clientes.get(solicitudes.get(id)?.clienteId ?? "")?.nombre ?? "",
          motivo: (paradaId) => motivos.get(paradaId) ?? null,
          puedeRegistrar,
        }, omitidas, activasHoy),
      });
      for (const alerta of proyeccion.alertas) resumenAlertas[alerta.tipo] += 1;
    }
    return {
      ok: true,
      valor: {
        fecha: dia,
        porJornada,
        incidentesAbiertos: await incidentesAbiertos(tx, dia),
        eventosRechazados: await eventosRechazadosSinConciliar(tx, dia),
        puedeResolver: puede(permiso.usuario, "incidentes.resolver"),
        puedeConciliar: puede(permiso.usuario, "operacion.conciliar"),
        puedeRegistrar,
        resumenAlertas,
      },
    };
  });
}

/**
 * Un modelo de tiempos dañado (por ejemplo, editado a mano en la base) no debe tumbar el seguimiento de todo el día: esa
 * jornada se proyecta sin modelos, desplazando las estimaciones, y la pantalla la marca "proyección aproximada".
 */
function proyectarConRespaldo(estado: EstadoJornada, opciones: Parameters<typeof proyectarJornada>[1]): ProyeccionJornada {
  try {
    return proyectarJornada(estado, opciones);
  } catch (error) {
    console.error("[seguimiento] proyección sin modelo de tiempos", estado.jornadaId, error instanceof Error ? error.message : "error");
    return proyectarJornada({ ...estado, viajes: estado.viajes.map((v) => ({ ...v, tiempos: null })) }, opciones);
  }
}

const hhmm = (instante: string) => {
  const m = minutoEnMexico(new Date(instante));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** Las paradas vigentes no cerradas de la jornada, con su hora estimada y la proyectada. */
function paradasEnSeguimiento(
  estado: EstadoJornada,
  proyeccion: ProyeccionJornada,
  datos: { disponible: boolean; folio: (solicitudId: string) => string; cliente: (solicitudId: string) => string },
): ParadaEnSeguimiento[] {
  const proyectadas = new Map(proyeccion.viajes.flatMap((v) => v.paradas.map((p) => [p.paradaId, p])));
  const salida: ParadaEnSeguimiento[] = [];
  for (const viaje of estado.viajes) {
    const enCurso = viaje.salidaPatioEn !== null && viaje.descargaFinEn === null;
    for (const p of viaje.paradas) {
      const proyectada = proyectadas.get(p.paradaId);
      if (!proyectada) continue;
      salida.push({
        paradaId: p.paradaId, solicitudId: p.solicitudId, folio: datos.folio(p.solicitudId), cliente: datos.cliente(p.solicitudId),
        ventana: { inicio: p.ventanaInicio, fin: p.ventanaFin },
        llegadaEstimada: hhmm(p.llegadaEstimada), llegadaProyectada: hhmm(proyectada.llegada),
        enViajeEnCurso: enCurso,
        liberable: datos.disponible && viaje.salidaPatioEn === null && p.vigente && p.estado === "pendiente",
        ubicacionSupuesta: proyectada.ubicacionSupuesta,
      });
    }
  }
  return salida;
}

/** HH:MM al minuto hacia abajo. hhmm redondea hacia arriba (lo usa la proyección del Plan 7, que no debe adelantar). */
const hhmmAbajo = (instante: string) => hhmm(new Date(Math.floor(Date.parse(instante) / 60_000) * 60_000).toISOString());

const ETIQUETA_VIAJE: Record<EstadoViajeTablero, string> = {
  en_espera: "En espera", en_camino: "En camino", descargando: "Descargando", terminado: "Terminado",
};
const ETIQUETA_PARADA: Record<EstadoParadaTablero, string> = {
  pendiente: "Pendiente", en_camino: "En camino", en_cliente: "En el cliente", recolectando: "Recolectando",
  recolectada: "Recolectada", no_atendida: "No se pudo atender", reasignada: "Reasignada", omitida: "Omitida",
};

function estadoDeViaje(v: EstadoJornada["viajes"][number]): EstadoViajeTablero {
  if (v.descargaFinEn) return "terminado";
  if (v.regresoPatioEn) return "descargando";
  if (v.salidaPatioEn) return "en_camino";
  return "en_espera";
}

/**
 * Tablero del día (diseño del 2026-11-21, §2.1): lo que hace cada camión en palabras, sus viajes en orden y cada
 * recolección con su estado. Solo traduce el estado de la jornada; no decide nada.
 */
export function tableroDeJornada(
  estado: EstadoJornada,
  proyeccion: ProyeccionJornada,
  datos: { folio: (solicitudId: string) => string; cliente: (solicitudId: string) => string; motivo: (paradaId: string) => string | null; puedeRegistrar: boolean },
  omitidas: { paradaId: string; solicitudId: string }[] = [],
  activasHoy: ReadonlySet<string> = new Set(),
): TableroJornada {
  const proyectadas = new Map(proyeccion.viajes.flatMap((v) => v.paradas.map((p) => [p.paradaId, p.llegada])));
  // Al minuto, hacia abajo (revisión de Codex): una marca a las 08:00:30 se ve 08:00, nunca 08:01 ni 24:00.
  const hora = (iso: string | null) => (iso ? hhmmAbajo(iso) : null);
  const viajes: ViajeTablero[] = estado.viajes.map((v, i) => {
    const estadoViaje = estadoDeViaje(v);
    const enOrden = [...v.paradas].sort((a, b) => a.secuencia - b.secuencia);
    // La siguiente del viaje en curso, si ninguna está ya en el cliente.
    const siguiente = estadoViaje === "en_camino" && !enOrden.some((p) => p.estado === "en_sitio" || p.estado === "en_servicio")
      ? enOrden.find((p) => p.vigente && p.estado === "pendiente") : undefined;
    const paradas = enOrden.map((p): ParadaTablero => {
      const e: EstadoParadaTablero = p.estado === "completada" ? "recolectada"
        : p.estado === "no_atendida" ? "no_atendida"
        : p.estado === "en_servicio" ? "recolectando"
        : p.estado === "en_sitio" ? "en_cliente"
        : p.estado === "reasignada" ? "reasignada"
        : p.estado === "omitida" ? "omitida"
        : p === siguiente ? "en_camino" : "pendiente";
      const horaParada = e === "recolectada" || e === "no_atendida" ? hora(p.cierreEn)
        : e === "recolectando" ? hora(p.inicioServicioEn)
        : e === "en_cliente" ? hora(p.llegadaEn)
        : e === "pendiente" || e === "en_camino" ? hora(proyectadas.get(p.paradaId) ?? p.llegadaEstimada)
        : null;
      return {
        paradaId: p.paradaId, folio: datos.folio(p.solicitudId), cliente: datos.cliente(p.solicitudId), estado: e,
        etiqueta: ETIQUETA_PARADA[e], hora: horaParada,
        horaPlan: e === "pendiente" || e === "en_camino" ? hora(p.llegadaEstimada) : null,
        ventana: { inicio: p.ventanaInicio, fin: p.ventanaFin },
        motivo: e === "no_atendida" ? datos.motivo(p.paradaId) : null,
      };
    });
    return {
      rutaId: v.rutaId, numero: i + 1, estado: estadoViaje, etiqueta: ETIQUETA_VIAJE[estadoViaje],
      salida: hora(v.salidaPatioEn), regreso: hora(v.regresoPatioEn), paradas,
    };
  });

  const todas = viajes.flatMap((v) => v.paradas).filter((p) => p.estado !== "reasignada" && p.estado !== "omitida");
  const recolecciones = { hechas: todas.filter((p) => p.estado === "recolectada").length, total: todas.length };
  return {
    frase: fraseDeJornada(estado, viajes), recolecciones, viajes,
    siguiente: datos.puedeRegistrar ? siguientePaso(estado, viajes, datos.cliente) : null,
    omitidas: pospuestasDelDia(omitidas, activasHoy).map((o) => ({ paradaId: o.paradaId, folio: datos.folio(o.solicitudId), cliente: datos.cliente(o.solicitudId) })),
  };
}

/**
 * Las omitidas de viajes que salieron de la secuencia, una vez por solicitud y solo si no volvió a quedar activa hoy en
 * algún camión (revisión de Codex del cabd8e8): una solicitud pospuesta en dos re-ruteos, o reprogramada para hoy y
 * asignada otra vez, no aparece dos veces ni a la vez como pospuesta y como recolección.
 */
export function pospuestasDelDia<T extends { solicitudId: string }>(omitidas: T[], activasHoy: ReadonlySet<string>): T[] {
  const vistas = new Set<string>();
  return omitidas.filter((o) => {
    if (activasHoy.has(o.solicitudId) || vistas.has(o.solicitudId)) return false;
    vistas.add(o.solicitudId);
    return true;
  });
}

function fraseDeJornada(estado: EstadoJornada, viajes: ViajeTablero[]): string {
  if (estado.checkOutEn) return "Jornada terminada";
  if (!estado.checkInEn) return "Sin llegar al patio";
  const enCurso = viajes.find((v) => v.estado === "en_camino" || v.estado === "descargando");
  if (enCurso) {
    const n = `Viaje ${enCurso.numero}`;
    if (enCurso.estado === "descargando") return `${n}: descargando en el patio`;
    const recolectando = enCurso.paradas.find((p) => p.estado === "recolectando");
    if (recolectando) return `${n}: recolectando en ${recolectando.cliente}`;
    const enCliente = enCurso.paradas.find((p) => p.estado === "en_cliente");
    if (enCliente) return `${n}: en ${enCliente.cliente}, esperando`;
    const camino = enCurso.paradas.find((p) => p.estado === "en_camino");
    return camino ? `${n}: en camino a ${camino.cliente}` : `${n}: regresando al patio`;
  }
  if (viajes.some((v) => v.estado === "terminado") && viajes.some((v) => v.estado === "en_espera")) return "En el patio, entre viajes";
  if (viajes.length > 0 && viajes.every((v) => v.estado === "terminado")) return "En el patio, viajes terminados";
  return "En el patio, sin salir";
}

/** El mismo siguiente paso que vería el operador (siguienteAccion), dicho para el despacho. */
function siguientePaso(estado: EstadoJornada, viajes: ViajeTablero[], cliente: (solicitudId: string) => string): SiguientePaso | null {
  if (estado.checkOutEn) return null;
  const accion = siguienteAccion(estado);
  if (!accion) return null;
  const viaje = viajes.find((v) => v.rutaId === accion.rutaId);
  const parada = estado.viajes.flatMap((v) => v.paradas).find((p) => p.paradaId === accion.paradaId);
  const quien = parada ? cliente(parada.solicitudId) : "";
  const n = viaje ? ` (viaje ${viaje.numero})` : "";
  const textos: Record<TipoEvento, string> = {
    check_in: "Llegó al patio", salida_patio: `Salió del patio${n}`, llegada: `Llegó a ${quien}`,
    inicio_servicio: `Empezó a recolectar en ${quien}`, fin_servicio: `Terminó de recolectar en ${quien}`,
    no_atendida: `No se pudo atender a ${quien}`, regreso_patio: `Regresó al patio${n}`,
    fin_descarga: `Terminó de descargar${n}`, check_out: "Terminó la jornada",
  };
  return {
    tipo: accion.tipo, texto: textos[accion.tipo], rutaId: accion.rutaId, paradaId: accion.paradaId, versionRuta: accion.versionRuta,
    pideOdometro: accion.tipo === "salida_patio" || accion.tipo === "regreso_patio",
    permiteNoAtendida: accion.permiteNoAtendida,
    // Al minuto, hacia abajo: con hhmm (hacia arriba) una marca a las 08:00:30 dejaría el mínimo en 08:01 y la pantalla no
    // permitiría marcar a las 08:00:50 (la pantalla manda la hora exacta si no se cambió; el servidor valida los segundos).
    desde: estado.ultimoOcurridoEn ? hhmmAbajo(estado.ultimoOcurridoEn) : null,
  };
}
