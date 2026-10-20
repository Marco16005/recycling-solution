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
import { estadoDeJornada, eventosRechazadosSinConciliar, incidentesAbiertos, leerJornadaOperacion, ultimoEventoAplicado } from "@/datos/operacion";
import { proyectarJornada, type AlertaOperacion, type EstadoJornada, type ProyeccionJornada, type TipoAlerta } from "@/dominio/operacion";
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
    const leidos: { j: (typeof jornadas)[number]; estado: EstadoJornada; proyeccion: ProyeccionJornada }[] = [];
    for (const j of jornadas) {
      const operacion = await leerJornadaOperacion(tx, j.id);
      if (!operacion) continue;
      const estado = await estadoDeJornada(tx, operacion);
      leidos.push({ j, estado, proyeccion: proyectarJornada(estado, opciones) });
    }
    // Folio y cliente de las paradas proyectadas, en una sola lectura.
    const ids = [...new Set(leidos.flatMap(({ estado }) => estado.viajes.flatMap((v) => v.paradas.map((p) => p.solicitudId))))];
    const solicitudes = new Map((await solicitudesPorId(tx, ids)).map((s) => [s.id, s]));
    const clientes = new Map((await leerClientesPorId(tx, [...new Set([...solicitudes.values()].map((s) => s.clienteId))])).map((c) => [c.id, c]));
    const resumenAlertas: Record<TipoAlerta, number> = { ventana_en_riesgo: 0, fuera_de_turno: 0, atraso: 0 };

    const porJornada: SeguimientoJornada[] = [];
    for (const { j, estado, proyeccion } of leidos) {
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
        resumenAlertas,
      },
    };
  });
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
