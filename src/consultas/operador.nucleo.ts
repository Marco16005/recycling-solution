import { permitir } from "@/acciones/autorizacion";
import type { Contexto, Resultado } from "@/acciones/tipos";
import { idSchema } from "@/acciones/validacion";
import { leerClientesPorId } from "@/datos/clientes";
import { leerUnidad } from "@/datos/flota";
import { estadoDeJornada, incidentesAbiertos, jornadaDelOperador, leerJornadaOperacion, paradasPorId, type JornadaOperacion } from "@/datos/operacion";
import { solicitudesPorId } from "@/datos/solicitudes";
import { operadorDeUsuario } from "@/datos/usuarios";
import type { EstadoJornada, EstadoParada } from "@/dominio/operacion/tipos";
import { fechaEnMexico } from "@/dominio/tiempo";
import { resumenUnidad, type UnidadResumen } from "./flota.nucleo";
import { leerInstantanea } from "./instantanea";

/** Contrato del Plan 5, §3.3. Horas como "HH:MM" en Ciudad de México; el estado completo va en `estado`. */
export interface ParadaMiRuta {
  paradaId: string; secuencia: number; folio: string; estado: EstadoParada; vigente: boolean;
  cliente: { nombre: string; direccion: string | null; notasAcceso: string | null; lat: number | null; lng: number | null };
  ventana: { inicio: string; fin: string }; llegadaEstimada: string; cargaKg: number;
}
export interface ViajeMiRuta { rutaId: string; version: number; numero: number; salidaEstimada: string; regresoEstimado: string; paradas: ParadaMiRuta[] }
export interface VistaMiRuta {
  fecha: string;
  jornadaId: string | null;
  unidad: UnidadResumen | null;
  estado: EstadoJornada | null;
  viajes: ViajeMiRuta[];
  incidentesAbiertos: { id: string; tipo: string; reportadoEn: Date }[];
}

const hora = (d: Date) => d.toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Las jornadas propias de las últimas 24 horas también se pueden abrir (eventos encolados sin señal; decisión 9). */
const VENTANA_MS = 24 * 60 * 60 * 1000;

/** Permiso ruta.operar. Sin jornadaId: la jornada de hoy del operador de la sesión. */
export async function miRuta(ctx: Contexto, jornadaId?: unknown): Promise<Resultado<VistaMiRuta>> {
  const permiso = permitir(ctx, "ruta.operar");
  if (!permiso.ok) return permiso;
  const hoy = fechaEnMexico(ctx.ahora);
  const vacia: VistaMiRuta = { fecha: hoy, jornadaId: null, unidad: null, estado: null, viajes: [], incidentesAbiertos: [] };

  return leerInstantanea(ctx.bd, async (tx): Promise<Resultado<VistaMiRuta>> => {
    const operadorId = await operadorDeUsuario(tx, permiso.usuario.id);
    if (operadorId === null) return { ok: true, valor: vacia };
    let j: JornadaOperacion | null;
    if (jornadaId === undefined) j = await jornadaDelOperador(tx, operadorId, hoy);
    else {
      const id = idSchema.safeParse(jornadaId);
      if (!id.success) return { ok: false, error: "no_encontrado" };
      j = await leerJornadaOperacion(tx, id.data);
      const reciente = j !== null && fechaEnMexico(new Date(ctx.ahora.getTime() - VENTANA_MS)) <= j.fecha;
      if (j === null || j.operadorId !== operadorId || !reciente) return { ok: false, error: "no_encontrado" };
    }
    if (j === null) return { ok: true, valor: vacia };

    const estado = await estadoDeJornada(tx, j);
    const unidad = await leerUnidad(tx, j.unidadId);
    const solicitudIds = estado.viajes.flatMap((v) => v.paradas.map((p) => p.solicitudId));
    const solicitudes = new Map((await solicitudesPorId(tx, solicitudIds)).map((s) => [s.id, s]));
    const clientes = new Map((await leerClientesPorId(tx, [...new Set([...solicitudes.values()].map((s) => s.clienteId))])).map((c) => [c.id, c]));
    const filas = new Map((await paradasPorId(tx, estado.viajes.flatMap((v) => v.paradas.map((p) => p.paradaId)))).map((p) => [p.id, p]));
    const viajes: ViajeMiRuta[] = estado.viajes.map((v, i) => ({
      rutaId: v.rutaId,
      version: v.version,
      numero: i + 1,
      salidaEstimada: hora(new Date(v.salidaEstimada)),
      regresoEstimado: hora(new Date(v.regresoEstimado)),
      paradas: v.paradas.map((p) => {
        const s = solicitudes.get(p.solicitudId)!;
        const c = clientes.get(s.clienteId)!;
        const f = filas.get(p.paradaId)!;
        return {
          paradaId: p.paradaId, secuencia: p.secuencia, folio: s.folio, estado: p.estado, vigente: p.vigente,
          cliente: { nombre: c.nombre, direccion: c.direccion, notasAcceso: c.notasAcceso, lat: c.lat, lng: c.lng },
          ventana: { inicio: f.ventanaInicio.slice(0, 5), fin: f.ventanaFin.slice(0, 5) },
          llegadaEstimada: hora(new Date(p.llegadaEstimada)),
          cargaKg: f.cargaKg,
        };
      }),
    }));
    const abiertos = (await incidentesAbiertos(tx, j.fecha)).filter((i) => i.jornadaId === j.id);
    return {
      ok: true,
      valor: {
        fecha: j.fecha, jornadaId: j.id, unidad: unidad ? resumenUnidad(unidad) : null, estado, viajes,
        incidentesAbiertos: abiertos.map((i) => ({ id: i.id, tipo: i.tipo, reportadoEn: i.reportadoEn })),
      },
    };
  });
}
