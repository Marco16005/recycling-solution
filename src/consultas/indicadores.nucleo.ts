import { permitir } from "@/acciones/autorizacion";
import type { Contexto, Resultado } from "@/acciones/tipos";
import { fechaSchema } from "@/acciones/validacion";
import { leerCartera } from "@/datos/clientes";
import { leerConfiguracionCompleta, type LineaBase } from "@/datos/configuracion";
import { leerDatosIndicadores, tomarInstantaneaK5, type DatosIndicadores } from "@/datos/indicadores";
import { resumenK5 } from "@/dominio/clientes/completitud";
import { fechaEnMexico } from "@/dominio/tiempo";
import { ciclo, csv, k1, k2, k3, k4, k5, k6, k7, type ConteosK3, type Medida, type RecoleccionMedida, type ViajeMedido } from "@/indicadores";
import { leerInstantanea } from "./instantanea";

/** Contrato del Plan 6, §3. Rango de fechas de hasta 92 días, en Ciudad de México. */
export interface VistaPanel {
  desde: string;
  hasta: string;
  lineaBase: LineaBase;
  k1: ReturnType<typeof k1>;
  k2: Medida;
  k3: ReturnType<typeof k3>;
  k4: ReturnType<typeof k4>;
  k5: ReturnType<typeof k5>;
  k6: ReturnType<typeof k6>;
  k7: ReturnType<typeof k7>;
  ciclo: Medida;
  tendencia: { fecha: string; k1Espera: Medida; k1Traslado: Medida; k3: Medida; ciclo: Medida }[];
}

const MAX_DIAS = 92;
const hhmm = (hora: string) => hora.slice(0, 5);
const min = (a: Date, b: Date) => (a.getTime() - b.getTime()) / 60_000;

export interface Medidas { recolecciones: RecoleccionMedida[]; viajes: ViajeMedido[]; conteos: Map<string, ConteosK3> }

/**
 * Arma las entradas de los indicadores (Plan 6, §2): un viaje físico es una ruta persistida; cuentan las paradas
 * completadas y no atendidas; la anterior es la cerrada previa en la secuencia del viaje. hoy: para contar pendientes al cierre.
 */
export function medidasDelRango(datos: DatosIndicadores, hoy: string): Medidas {
  const paradasPorRuta = new Map<string, DatosIndicadores["paradas"]>();
  for (const p of datos.paradas) paradasPorRuta.set(p.rutaId, [...(paradasPorRuta.get(p.rutaId) ?? []), p]);
  // Número de viaje en la jornada, por la salida real (o la estimada si no salió).
  const numero = new Map<string, number>();
  const porJornada = new Map<string, typeof datos.rutas>();
  for (const r of datos.rutas) porJornada.set(r.jornadaId, [...(porJornada.get(r.jornadaId) ?? []), r]);
  for (const rs of porJornada.values()) {
    rs.sort((a, b) => (a.salidaPatioEn ?? a.salidaEstimada).getTime() - (b.salidaPatioEn ?? b.salidaEstimada).getTime())
      .forEach((r, i) => numero.set(r.id, i + 1));
  }

  const recolecciones: RecoleccionMedida[] = [];
  const viajes: ViajeMedido[] = [];
  const conteos = new Map<string, ConteosK3>();
  const contar = (fecha: string, campo: keyof ConteosK3) => {
    const c = conteos.get(fecha) ?? { noAtendidas: 0, omitidas: 0, pendientesAlCierre: 0 };
    c[campo] += 1;
    conteos.set(fecha, c);
  };

  for (const r of datos.rutas) {
    const ps = [...(paradasPorRuta.get(r.id) ?? [])].sort((a, b) => a.secuencia - b.secuencia);
    const cerradas = ps.filter((p) => p.estado === "completada" || p.estado === "no_atendida");
    const completadas = cerradas.filter((p) => p.estado === "completada");
    const ultimoCierre = cerradas.at(-1)?.cierreEn ?? null;
    const regresoMasDescargaMin = r.descargaFinEn && ultimoCierre ? min(r.descargaFinEn, ultimoCierre) : null;
    for (const p of ps) {
      if (p.estado === "no_atendida") contar(p.fecha, "noAtendidas");
      if (p.estado === "omitida") contar(p.fecha, "omitidas");
      if (p.vigente && p.estado === "pendiente" && p.fecha < hoy) contar(p.fecha, "pendientesAlCierre");
    }
    cerradas.forEach((p, i) => {
      recolecciones.push({
        fecha: p.fecha, folio: p.folio, cliente: p.cliente, placa: r.placa, viajeId: r.id, numeroViajeEnJornada: numero.get(r.id) ?? 1,
        estado: p.estado as "completada" | "no_atendida",
        asignadaEn: r.asignadaEn, disponibleParaSalirEn: r.disponibleParaSalirEn,
        llegadaEn: p.llegadaEn, inicioServicioEn: p.inicioServicioEn, finServicioEn: p.finServicioEn,
        ventanaInicio: hhmm(p.ventanaInicio), ventanaFin: hhmm(p.ventanaFin),
        anterior: i === 0 ? { tipo: "primera", salidaPatioEn: r.salidaPatioEn } : { tipo: "anterior", cierreEn: cerradas[i - 1].cierreEn },
        completadasDelViaje: completadas.length, regresoMasDescargaMin, kmContrafactual: p.kmContrafactual,
      });
    });
    viajes.push({
      viajeId: r.id, odometroInicioKm: r.odometroInicioKm, odometroFinKm: r.odometroFinKm, rendimientoKmL: r.rendimientoKmLUsado,
      kmContrafactualCompletadas: completadas.reduce((s, p) => s + p.kmContrafactual, 0),
    });
  }
  return { recolecciones, viajes, conteos };
}

const sumarConteos = (cs: Iterable<ConteosK3>): ConteosK3 => {
  const total = { noAtendidas: 0, omitidas: 0, pendientesAlCierre: 0 };
  for (const c of cs) {
    total.noAtendidas += c.noAtendidas;
    total.omitidas += c.omitidas;
    total.pendientesAlCierre += c.pendientesAlCierre;
  }
  return total;
};

type Rango = { desde: string; hasta: string };

function validarRango(ctx: Contexto, desde: unknown, hasta: unknown): Rango | Extract<Resultado<never>, { ok: false }> {
  const hoy = fechaEnMexico(ctx.ahora);
  const d = desde === undefined ? hoy : fechaSchema.safeParse(desde).data;
  const h = hasta === undefined ? hoy : fechaSchema.safeParse(hasta).data;
  if (d === undefined || h === undefined || d > h) return { ok: false, error: "invalido", campos: { desde: ["Rango de fechas no válido"] } };
  const dias = (Date.parse(`${h}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000 + 1;
  if (dias > MAX_DIAS) return { ok: false, error: "invalido", campos: { desde: [`El rango no puede pasar de ${MAX_DIAS} días`] } };
  return { desde: d, hasta: h };
}

/** Toma la instantánea de K5 de hoy si falta (la primera consulta del día la deja). */
async function asegurarInstantaneaK5(ctx: Contexto): Promise<void> {
  await ctx.bd.transaction(async (tx) => {
    const { versionAvisoPrivacidad } = await leerConfiguracionCompleta(tx);
    const k = resumenK5(await leerCartera(tx), versionAvisoPrivacidad);
    await tomarInstantaneaK5(tx, fechaEnMexico(ctx.ahora), k.activos, k.completos, ctx.ahora);
  });
}

/** Permiso indicadores.ver. desde y hasta: "AAAA-MM-DD" (por omisión, hoy). */
export async function panel(ctx: Contexto, desde?: unknown, hasta?: unknown): Promise<Resultado<VistaPanel>> {
  const permiso = permitir(ctx, "indicadores.ver");
  if (!permiso.ok) return permiso;
  const rango = validarRango(ctx, desde, hasta);
  if ("ok" in rango) return rango;
  await asegurarInstantaneaK5(ctx);

  const { datos, config, cartera } = await leerInstantanea(ctx.bd, async (tx) => ({
    datos: await leerDatosIndicadores(tx, rango.desde, rango.hasta),
    config: await leerConfiguracionCompleta(tx),
    cartera: await leerCartera(tx),
  }));
  const { recolecciones, viajes, conteos } = medidasDelRango(datos, fechaEnMexico(ctx.ahora));
  const actual = resumenK5(cartera, config.versionAvisoPrivacidad);
  const fechas = [...new Set(recolecciones.map((r) => r.fecha))].sort();
  return {
    ok: true,
    valor: {
      ...rango,
      lineaBase: config.lineaBase,
      k1: k1(recolecciones),
      k2: k2(datos.capturasSeg, config.lineaBase.k2Seg ?? null),
      k3: k3(recolecciones, sumarConteos(conteos.values())),
      k4: k4(viajes, datos.planes.filter((p) => p.tipo === "inicial").map((p) => ({ km: p.resumen.km, kmMetodoActual: p.resumen.kmMetodoActual }))),
      k5: k5({ activos: actual.activos, completos: actual.completos }, datos.serieK5),
      k6: k6(datos.planes.map((p) => ({ tipo: p.tipo, generadoEn: p.generadoEn, revisionIniciadaEn: p.revisionIniciadaEn, validadoEn: p.validadoEn }))),
      k7: k7(datos.ejecuciones),
      ciclo: ciclo(recolecciones),
      tendencia: fechas.map((fecha) => {
        const delDia = recolecciones.filter((r) => r.fecha === fecha);
        const k = k1(delDia);
        return {
          fecha, k1Espera: k.espera, k1Traslado: k.traslado,
          k3: k3(delDia, conteos.get(fecha) ?? { noAtendidas: 0, omitidas: 0, pendientesAlCierre: 0 }), ciclo: ciclo(delDia),
        };
      }),
    },
  };
}

/** Permiso indicadores.ver. El CSV de las recolecciones del rango (una fila por recolección). */
export async function csvDelRango(ctx: Contexto, desde?: unknown, hasta?: unknown): Promise<Resultado<{ nombre: string; contenido: string }>> {
  const permiso = permitir(ctx, "indicadores.ver");
  if (!permiso.ok) return permiso;
  const rango = validarRango(ctx, desde, hasta);
  if ("ok" in rango) return rango;
  const datos = await leerInstantanea(ctx.bd, (tx) => leerDatosIndicadores(tx, rango.desde, rango.hasta));
  const { recolecciones } = medidasDelRango(datos, fechaEnMexico(ctx.ahora));
  return { ok: true, valor: { nombre: `recolecciones-${rango.desde}-a-${rango.hasta}.csv`, contenido: csv(recolecciones) } };
}
