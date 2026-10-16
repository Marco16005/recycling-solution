import { permitir } from "@/acciones/autorizacion";
import type { Contexto, Resultado } from "@/acciones/tipos";
import { fechaSchema } from "@/acciones/validacion";
import { leerOperadores, leerUnidades } from "@/datos/flota";
import { leerJornadas } from "@/datos/jornadas";
import { estadoDeJornada, eventosRechazadosSinConciliar, incidentesAbiertos, leerJornadaOperacion, ultimoEventoAplicado } from "@/datos/operacion";
import { fechaEnMexico } from "@/dominio/tiempo";
import { puede } from "@/seguridad/permisos";
import { leerInstantanea } from "./instantanea";

/** Contrato del Plan 5, §3.3: avance de cada jornada del día, incidentes abiertos y eventos rechazados por conciliar. */
export interface SeguimientoJornada {
  jornadaId: string; operador: string; placa: string;
  avance: { completadas: number; noAtendidas: number; pendientes: number; enSitio: number };
  ultimoEvento: { tipo: string; en: Date } | null;
  checkIn: boolean; checkOut: boolean;
}
export interface VistaSeguimiento {
  fecha: string;
  porJornada: SeguimientoJornada[];
  incidentesAbiertos: { id: string; version: number; jornadaId: string; paradaId: string | null; tipo: string; descripcion: string; reportadoEn: Date }[];
  eventosRechazados: { eventoId: string; jornadaId: string; tipo: string; ocurridoEn: Date; motivoRechazo: string | null }[];
  puedeResolver: boolean;
  puedeConciliar: boolean;
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
    const porJornada: SeguimientoJornada[] = [];
    for (const j of jornadas) {
      const operacion = await leerJornadaOperacion(tx, j.id);
      if (!operacion) continue;
      const estado = await estadoDeJornada(tx, operacion);
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
      });
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
      },
    };
  });
}
