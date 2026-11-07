import { TOLERANCIA_POR_OMISION_MIN } from "@/motor/admision";
import { validarFranjas } from "@/motor/traslados";
import { ErrorTraslados } from "@/motor/tipos";
import type { EntradaPlan, Plan, VentanaMin } from "@/motor/tipos";
import { diaSemanaDeFecha } from "../clientes/habilitacion";
import { cargaEfectivaKg } from "../solicitudes/cola";
import { fechaEnMexico } from "../tiempo";
import { TIPOS_UNIDAD, type Cliente, type ClienteGuardado, type TipoUnidad } from "../clientes/tipos";
import type { UnidadGuardada } from "../flota/tipos";
import type { SolicitudGuardada } from "../solicitudes/tipos";
import type { ConfiguracionPlan, JornadaParaPlan } from "./tipos";

const relojMexico = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function partesEnMexico(instante: Date): Record<string, number> {
  return Object.fromEntries(relojMexico.formatToParts(instante)
    .filter(p => p.type !== "literal").map(p => [p.type, Number(p.value)]));
}

function medianocheUtc(fecha: string): number {
  const ms = Date.parse(`${fecha}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !Number.isFinite(ms)
    || new Date(ms).toISOString().slice(0, 10) !== fecha) throw new Error("Fecha inválida");
  return ms;
}

/** Acepta HH:MM y HH:MM:SS; redondea hacia arriba para no adelantar la disponibilidad. */
export function minutosDeHora(hhmm: string): number {
  const partes = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(hhmm);
  if (!partes || Number(partes[1]) > 23 || Number(partes[2]) > 59 || Number(partes[3] ?? 0) > 59)
    throw new Error("Hora inválida");
  return Number(partes[1]) * 60 + Number(partes[2]) + (Number(partes[3] ?? 0) > 0 ? 1 : 0);
}

/** AAAAMMDD como entero. */
export function semillaDeFecha(fecha: string): number {
  medianocheUtc(fecha);
  return Number(fecha.replace(/-/g, ""));
}

/** Minuto en Ciudad de México, redondeado hacia arriba si hay segundos; zona explícita con Intl. */
export function minutoEnMexico(instante: Date): number {
  const p = partesEnMexico(instante);
  return p.hour * 60 + p.minute + (p.second > 0 || instante.getUTCMilliseconds() > 0 ? 1 : 0);
}

/** Instante de fecha + minutos en Ciudad de México, sin desfases fijos. */
export function instanteDeMinutos(fecha: string, minutos: number): Date {
  if (!Number.isSafeInteger(minutos)) throw new Error("Minutos inválidos");
  const objetivo = medianocheUtc(fecha) + minutos * 60000;
  let candidato = objetivo;
  // Resuelve la hora civil con el desfase que Intl devuelve para ese instante, incluso si cambia por horario estacional.
  for (let intento = 0; intento < 4; intento++) {
    const p = partesEnMexico(new Date(candidato));
    const civil = new Date(0);
    civil.setUTCFullYear(p.year, p.month - 1, p.day);
    civil.setUTCHours(p.hour, p.minute, p.second, 0);
    const diferencia = objetivo - civil.getTime();
    if (diferencia === 0) return new Date(candidato);
    candidato += diferencia;
  }
  throw new Error("Hora local inexistente en Ciudad de México");
}

/** Ventanas para el día de la semana de fecha, en minutos. */
export function ventanasDelDia(cliente: Cliente, fecha: string): VentanaMin[] {
  medianocheUtc(fecha);
  const dia = diaSemanaDeFecha(fecha);
  return cliente.ventanas.filter(v => v.diaSemana === dia)
    .map(v => ({ inicioMin: minutosDeHora(v.horaInicio), finMin: minutosDeHora(v.horaFin) }))
    .sort((a, b) => a.inicioMin - b.inicioMin || a.finMin - b.finMin);
}

/** Solicitudes listas y jornadas disponibles; capacidades sobre todo el catálogo activo. */
export function construirEntrada(datos: {
  fecha: string;
  ahora: Date;
  solicitudes: { solicitud: SolicitudGuardada; cliente: ClienteGuardado }[];
  jornadas: JornadaParaPlan[];
  unidadesActivas: UnidadGuardada[];
  configuracion: ConfiguracionPlan;
}): EntradaPlan {
  const c = datos.configuracion;
  const horasPico = (c.horasPico ?? []).map(f => {
    if (!/^\d{2}:\d{2}$/.test(f.inicio) || !/^\d{2}:\d{2}$/.test(f.fin))
      throw new ErrorTraslados("franjas_invalidas");
    return { inicioMin: minutosDeHora(f.inicio), finMin: minutosDeHora(f.fin), factor: f.factor };
  });
  if (validarFranjas(horasPico)) throw new ErrorTraslados("franjas_invalidas");
  if (c.patioLat === null || c.patioLng === null) throw new ErrorDeEntrada("sin_patio");
  medianocheUtc(datos.fecha);
  const hoy = fechaEnMexico(datos.ahora);
  if (datos.fecha < hoy) throw new ErrorDeEntrada("fecha_pasada");
  const patio = { lat: c.patioLat, lng: c.patioLng };
  const turnoInicioMin = minutosDeHora(c.turnoInicio);
  const instanteMin = datos.fecha === hoy ? Math.max(turnoInicioMin, minutoEnMexico(datos.ahora) + MARGEN_REVISION_MIN) : turnoInicioMin;
  return {
    fecha: datos.fecha, instanteMin,
    solicitudes: datos.solicitudes.map(({ solicitud: s, cliente }) => {
      if (cliente.lat === null || cliente.lng === null) throw new Error("Cliente sin ubicación en las solicitudes listas");
      return { id: s.id, folio: s.folio, registradaEn: s.registradaEn.toISOString(), clienteId: s.clienteId,
        ubicacion: { lat: cliente.lat, lng: cliente.lng }, ventanas: ventanasDelDia(cliente, datos.fecha),
        tiempoServicioMin: cliente.tiempoServicioMin, cargaKg: cargaEfectivaKg(s, cliente, c.cargaPorOmisionKg),
        tiposUnidadAdmitidos: [...cliente.tiposUnidadAdmitidos] };
    }),
    unidades: datos.jornadas.map(j => ({ id: j.jornadaId, tipo: j.unidad.tipo, capacidadKg: j.unidad.capacidadKg,
      ubicacionInicial: { ...patio }, libreDesdeMin: Math.max(minutosDeHora(j.disponibleDesde), instanteMin), cargaActualKg: 0 })),
    parametros: { patio, turnoInicioMin, turnoFinMin: minutosDeHora(c.turnoFin), velocidadKmh: c.velocidadKmh,
      factorCircuidad: c.factorCircuidad, descargaMin: c.descargaMin, horasPico,
      // Plan 8: la tolerancia de la configuración (0 a 60); la del motor por omisión si la configuración no la trae.
      toleranciaReadmisionMin: c.toleranciaReadmisionMin ?? TOLERANCIA_POR_OMISION_MIN,
      capacidadMaximaPorTipoKg: capacidadMaximaPorTipo(datos.unidadesActivas), semilla: semillaDeFecha(datos.fecha) },
  };
}

export class ErrorDeEntrada extends Error {
  constructor(readonly codigo: "sin_patio" | "fecha_pasada") {
    super(codigo);
    this.name = "ErrorDeEntrada";
  }
}

/** Tiempo para revisar antes de la primera salida, al generar y al actualizar la hora. */
export const MARGEN_REVISION_MIN = 10;

/** Mayor capacidad de las unidades activas por tipo; compartida con la validación. */
export function capacidadMaximaPorTipo(unidadesActivas: UnidadGuardada[]): Record<TipoUnidad, number> {
  const capacidades = Object.fromEntries(TIPOS_UNIDAD.map(tipo => [tipo, 0])) as Record<TipoUnidad, number>;
  for (const u of unidadesActivas) if (u.activo) capacidades[u.tipo] = Math.max(capacidades[u.tipo], u.capacidadKg);
  return capacidades;
}

export const TIPOS_REQUISITO_OPERADOR = ["induccion_seguridad_cliente"] as const;

/** Clientes por jornada cuyos requisitos de acceso dependen del operador. */
export function requisitosPorJornada(
  plan: Plan,
  clientesPorSolicitud: Map<string, ClienteGuardado>,
): Map<string, { clienteId: string; nombre: string; tipos: string[] }[]> {
  const resultado = new Map<string, { clienteId: string; nombre: string; tipos: string[] }[]>();
  for (const ruta of plan.rutas) {
    const clientes = new Map<string, { clienteId: string; nombre: string; tipos: string[] }>();
    for (const viaje of ruta.viajes) for (const parada of viaje.paradas) {
      const cliente = clientesPorSolicitud.get(parada.solicitudId);
      if (!cliente) throw new Error("Falta el cliente de una parada del plan");
      const tipos = TIPOS_REQUISITO_OPERADOR.filter(tipo => cliente.documentos.some(d => d.obligatorio && d.tipoDocumentoId === tipo));
      if (tipos.length) clientes.set(cliente.id, { clienteId: cliente.id, nombre: cliente.nombre, tipos: [...tipos] });
    }
    resultado.set(ruta.unidadId, [...clientes.values()]);
  }
  return resultado;
}
