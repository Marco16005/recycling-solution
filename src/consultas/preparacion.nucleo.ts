import { permitir } from "@/acciones/autorizacion";
import type { Contexto, Resultado } from "@/acciones/tipos";
import { fechaSchema } from "@/acciones/validacion";
import { leerCartera } from "@/datos/clientes";
import { leerConfiguracionCompleta, type ConfiguracionCompleta } from "@/datos/configuracion";
import { leerCatalogo, leerOperadores, leerUnidades } from "@/datos/flota";
import { leerJornadas, type JornadaGuardada } from "@/datos/jornadas";
import { leerSolicitudesParaCola } from "@/datos/solicitudes";
import { diaSemanaDeFecha, type MotivoBloqueo } from "@/dominio/clientes/habilitacion";
import { ETIQUETA_BLOQUEO, ETIQUETA_NO_DISPONIBLE, ETIQUETA_UNIDAD } from "@/dominio/clientes/etiquetas";
import type { ClienteGuardado } from "@/dominio/clientes/tipos";
import { motivosNoDisponibleOperador, motivosNoDisponibleUnidad } from "@/dominio/flota/disponibilidad";
import type { MotivoNoDisponible, OperadorGuardado, TipoDocumento, UnidadGuardada } from "@/dominio/flota/tipos";
import { MARGEN_REVISION_MIN, minutoEnMexico, minutosDeHora } from "@/dominio/plan/entrada";
import { colaDelDia, siguienteDiaOperacion } from "@/dominio/solicitudes/cola";
import type { SolicitudGuardada } from "@/dominio/solicitudes/tipos";
import { fechaEnMexico } from "@/dominio/tiempo";
import { leerInstantanea } from "./instantanea";

/**
 * Lista "Antes de generar" del plan del día (diseño del 2026-11-21). Revisa la fecha con las mismas funciones que usa el
 * motor al generar (colaDelDia, disponibilidad de unidades y operadores, patio, días de operación y turno) y dice en
 * lenguaje simple qué falta y dónde se corrige. Solo lectura; orienta, no bloquea: el motor y la validación deciden.
 */

export type EstadoPunto = "bien" | "aviso" | "falta";
export type ClavePunto = "patio" | "dia" | "turno" | "camiones" | "solicitudes" | "tipos";

export interface Enlace { href: string; texto: string }
export interface Pendiente { texto: string; enlace: Enlace | null }

export interface PuntoPreparacion {
  clave: ClavePunto;
  estado: EstadoPunto;
  titulo: string;
  detalle: string;
  enlace: Enlace | null;
  pendientes: Pendiente[];
}

export interface Preparacion {
  fecha: string;
  /** Sin puntos en "falta": se puede generar (el motor aún puede posponer solicitudes). */
  listo: boolean;
  faltan: number;
  avisos: number;
  puntos: PuntoPreparacion[];
}

export interface DatosPreparacion {
  fecha: string;
  hoy: string;
  /** Minuto del día en Ciudad de México. */
  minutoActual: number;
  config: Pick<ConfiguracionCompleta, "patioLat" | "patioLng" | "diasOperacion" | "turnoFin" | "versionAvisoPrivacidad" | "diasParaAtrasada">;
  solicitudes: SolicitudGuardada[];
  clientes: ClienteGuardado[];
  jornadas: JornadaGuardada[];
  unidades: UnidadGuardada[];
  operadores: OperadorGuardado[];
  catalogoUnidad: TipoDocumento[];
  catalogoOperador: TipoDocumento[];
}

/** Por debajo de esto, el turno que queda hoy alcanza para pocas recolecciones. */
export const TURNO_CORTO_MIN = 180;

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "sábado 21 de noviembre". */
export function fechaLegible(fecha: string): string {
  const [, mes, dia] = fecha.split("-").map(Number);
  return `${DIAS[diaSemanaDeFecha(fecha)]} ${dia} de ${MESES[mes - 1]}`;
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const duracion = (min: number) => {
  const h = Math.floor(min / 60), m = min % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
};
const textoBloqueo = (m: MotivoBloqueo) => ETIQUETA_BLOQUEO[m.codigo] + (m.detalle ? ` (${m.detalle})` : "");
const textoNoDisponible = (m: MotivoNoDisponible) => ETIQUETA_NO_DISPONIBLE[m.codigo] + (m.detalle ? ` (${m.detalle})` : "");
const planDe = (fecha: string): Enlace => ({ href: `/despacho/plan?fecha=${fecha}`, texto: `Planear el ${fechaLegible(fecha)}` });

function puntoPatio(d: DatosPreparacion): PuntoPreparacion {
  const base = { clave: "patio" as const, titulo: "Ubicación del patio", pendientes: [] };
  if (d.config.patioLat !== null && d.config.patioLng !== null) {
    return { ...base, estado: "bien", detalle: "Está marcada en el mapa.", enlace: null };
  }
  return {
    ...base, estado: "falta",
    detalle: "Falta marcar el patio en el mapa. Sin él no se puede generar el plan, porque las rutas salen y regresan ahí. Lo marca el administrador.",
    enlace: { href: "/admin/configuracion", texto: "Ir a Configuración" },
  };
}

function puntoDia(d: DatosPreparacion): PuntoPreparacion {
  const base = { clave: "dia" as const, titulo: "Día", pendientes: [] };
  if (d.fecha < d.hoy) {
    return { ...base, estado: "falta", detalle: `El ${fechaLegible(d.fecha)} ya pasó. Solo se planea hoy o una fecha futura.`, enlace: planDe(d.hoy) };
  }
  if (!d.config.diasOperacion.includes(diaSemanaDeFecha(d.fecha))) {
    const siguiente = siguienteDiaOperacion(d.fecha, d.config.diasOperacion);
    return {
      ...base, estado: "falta",
      detalle: `El ${fechaLegible(d.fecha)} no es día de operación. El siguiente es el ${fechaLegible(siguiente)}.`,
      enlace: planDe(siguiente),
    };
  }
  return { ...base, estado: "bien", detalle: `El ${fechaLegible(d.fecha)} es día de operación.`, enlace: null };
}

/** Solo hoy: el motor empieza a contar desde ahora más el margen de revisión hasta el fin del turno. */
function puntoTurno(d: DatosPreparacion): PuntoPreparacion | null {
  if (d.fecha !== d.hoy || !d.config.diasOperacion.includes(diaSemanaDeFecha(d.fecha))) return null;
  const fin = d.config.turnoFin.slice(0, 5);
  const restante = minutosDeHora(d.config.turnoFin) - (d.minutoActual + MARGEN_REVISION_MIN);
  const siguiente = siguienteDiaOperacion(d.fecha, d.config.diasOperacion);
  const base = { clave: "turno" as const, titulo: "Tiempo de turno que queda hoy", pendientes: [] };
  if (restante <= 0) {
    return { ...base, estado: "falta", detalle: `El turno de hoy ya terminó (a las ${fin}). Planea el siguiente día de operación.`, enlace: planDe(siguiente) };
  }
  if (restante < TURNO_CORTO_MIN) {
    return {
      ...base, estado: "aviso",
      detalle: `Quedan ${duracion(restante)} de turno (termina a las ${fin}). Caben pocas recolecciones, porque cada una lleva su servicio más el traslado; las demás saldrán pospuestas. Si las solicitudes son para el siguiente día, planea ese día.`,
      enlace: planDe(siguiente),
    };
  }
  return { ...base, estado: "bien", detalle: `Quedan ${duracion(restante)} de turno (termina a las ${fin}).`, enlace: null };
}

function evaluarJornadas(d: DatosPreparacion) {
  const unidades = new Map(d.unidades.map((u) => [u.id, u]));
  const operadores = new Map(d.operadores.map((o) => [o.id, o]));
  const disponibles: UnidadGuardada[] = [];
  const pendientes: Pendiente[] = [];
  for (const j of d.jornadas) {
    const unidad = unidades.get(j.unidadId);
    const operador = operadores.get(j.operadorId);
    const motivosUnidad = unidad ? motivosNoDisponibleUnidad(unidad, d.catalogoUnidad, d.fecha) : [];
    const motivosOperador = operador ? motivosNoDisponibleOperador(operador, d.catalogoOperador, d.fecha) : [];
    if (unidad && operador && motivosUnidad.length === 0 && motivosOperador.length === 0) {
      disponibles.push(unidad);
      continue;
    }
    if (unidad && motivosUnidad.length > 0) {
      pendientes.push({
        texto: `Unidad ${unidad.placa}: ${motivosUnidad.map(textoNoDisponible).join("; ")}`,
        enlace: { href: `/despacho/unidades/${unidad.id}`, texto: "Abrir unidad" },
      });
    }
    if (operador && motivosOperador.length > 0) {
      pendientes.push({
        texto: `Operador ${operador.nombre}: ${motivosOperador.map(textoNoDisponible).join("; ")}`,
        enlace: { href: `/despacho/operadores/${operador.id}`, texto: "Abrir operador" },
      });
    }
  }
  return { disponibles, pendientes };
}

function puntoCamiones(d: DatosPreparacion, disponibles: UnidadGuardada[], pendientes: Pendiente[]): PuntoPreparacion {
  const base = { clave: "camiones" as const, titulo: "Camiones del día", pendientes };
  const enJornada = { href: `/despacho/jornada?fecha=${d.fecha}`, texto: "Ir a Jornada" };
  const total = d.jornadas.length;
  if (total === 0) {
    return { ...base, estado: "falta", detalle: "No hay camiones asignados a este día. En Jornada, elige qué unidad sale con qué operador.", enlace: enJornada };
  }
  if (disponibles.length === 0) {
    return {
      ...base, estado: "falta",
      detalle: `Hay ${plural(total, "jornada", "jornadas")}, pero ninguna se puede usar. Corrige lo que falta en la ficha de cada uno:`,
      enlace: enJornada,
    };
  }
  if (disponibles.length < total) {
    return {
      ...base, estado: "aviso",
      detalle: `${disponibles.length} de ${total} camiones se pueden usar. Los demás no entran al plan hasta que se corrija su ficha:`,
      enlace: enJornada,
    };
  }
  return { ...base, estado: "bien", detalle: `${plural(total, "camión", "camiones")} con operador, listos para salir.`, enlace: null };
}

function puntoSolicitudes(d: DatosPreparacion, clientes: Map<string, ClienteGuardado>) {
  const cola = colaDelDia(d.solicitudes, clientes, d.fecha, d.config.versionAvisoPrivacidad, d.config.diasOperacion, d.config.diasParaAtrasada);
  const listas = cola.filter((e) => e.estado === "lista");
  const bloqueadas = cola.filter((e) => e.estado === "bloqueada");
  const futuras = cola.filter((e) => e.estado === "futura").length;

  // Una línea por cliente bloqueado, con cuántas solicitudes detiene y por qué.
  const porCliente = new Map<string, { cuantas: number; motivos: MotivoBloqueo[] }>();
  for (const e of bloqueadas) {
    const previo = porCliente.get(e.solicitud.clienteId);
    if (previo) previo.cuantas++;
    else porCliente.set(e.solicitud.clienteId, { cuantas: 1, motivos: e.motivos });
  }
  const pendientes: Pendiente[] = [...porCliente].map(([id, { cuantas, motivos }]) => ({
    texto: `${clientes.get(id)?.nombre ?? "Cliente"} (${plural(cuantas, "solicitud", "solicitudes")}): ${motivos.map(textoBloqueo).join("; ")}`,
    enlace: { href: `/despacho/clientes/${id}`, texto: "Abrir ficha del cliente" },
  }));
  if (futuras > 0) {
    pendientes.push({
      texto: `${plural(futuras, "solicitud es", "solicitudes son")} para una fecha posterior; ${futuras === 1 ? "aparecerá" : "aparecerán"} en el plan de ese día.`,
      enlace: null,
    });
  }

  const base = { clave: "solicitudes" as const, titulo: "Solicitudes", pendientes };
  const enSolicitudes = { href: `/despacho/solicitudes?fecha=${d.fecha}`, texto: "Ir a Solicitudes" };
  let punto: PuntoPreparacion;
  if (cola.length === 0) {
    punto = { ...base, estado: "falta", detalle: "No hay solicitudes pendientes para este día. Regístralas en Solicitudes.", enlace: enSolicitudes };
  } else if (listas.length === 0) {
    punto = {
      ...base, estado: "falta",
      detalle: bloqueadas.length > 0
        ? "Ninguna solicitud está lista para planear. Estos clientes tienen algo pendiente en su ficha; al corregirlo, sus solicitudes vuelven solas a la cola con su hora original:"
        : "Ninguna solicitud está lista para planear este día:",
      enlace: enSolicitudes,
    };
  } else if (bloqueadas.length > 0) {
    punto = {
      ...base, estado: "aviso",
      detalle: `${plural(listas.length, "solicitud lista", "solicitudes listas")} para planear. ${plural(bloqueadas.length, "bloqueada no entra", "bloqueadas no entran")} hasta que se corrija la ficha del cliente:`,
      enlace: enSolicitudes,
    };
  } else {
    punto = { ...base, estado: "bien", detalle: `${plural(listas.length, "solicitud lista", "solicitudes listas")} para planear.`, enlace: null };
  }
  return { punto, listas };
}

/** Clientes con solicitud lista que no admiten ningún tipo de los camiones que se pueden usar: el motor los pospondrá. */
function puntoTipos(listas: { solicitud: SolicitudGuardada }[], clientes: Map<string, ClienteGuardado>, disponibles: UnidadGuardada[]): PuntoPreparacion | null {
  if (listas.length === 0 || disponibles.length === 0) return null;
  const tipos = new Set(disponibles.map((u) => u.tipo));
  const nombresTipos = [...tipos].map((t) => ETIQUETA_UNIDAD[t]).join(", ");
  const incompatibles = new Map<string, ClienteGuardado>();
  for (const { solicitud } of listas) {
    const cliente = clientes.get(solicitud.clienteId);
    if (cliente && !cliente.tiposUnidadAdmitidos.some((t) => tipos.has(t))) incompatibles.set(cliente.id, cliente);
  }
  const base = { clave: "tipos" as const, titulo: "Tipo de camión" };
  if (incompatibles.size === 0) {
    return { ...base, estado: "bien", detalle: "Cada cliente admite al menos uno de los camiones del día.", enlace: null, pendientes: [] };
  }
  return {
    ...base, estado: "aviso",
    detalle: `Estos clientes no admiten ninguno de los camiones del día (${nombresTipos}); sus solicitudes saldrán pospuestas:`,
    enlace: null,
    pendientes: [...incompatibles.values()].map((c) => ({
      texto: `${c.nombre}: admite ${c.tiposUnidadAdmitidos.map((t) => ETIQUETA_UNIDAD[t]).join(", ") || "ningún tipo"}`,
      enlace: { href: `/despacho/clientes/${c.id}`, texto: "Abrir ficha del cliente" },
    })),
  };
}

export function evaluarPreparacion(d: DatosPreparacion): Preparacion {
  const clientes = new Map(d.clientes.map((c) => [c.id, c]));
  const { disponibles, pendientes } = evaluarJornadas(d);
  const { punto: solicitudes, listas } = puntoSolicitudes(d, clientes);
  const puntos = [
    puntoPatio(d),
    puntoDia(d),
    puntoTurno(d),
    puntoCamiones(d, disponibles, pendientes),
    solicitudes,
    puntoTipos(listas, clientes, disponibles),
  ].filter((p): p is PuntoPreparacion => p !== null);
  const faltan = puntos.filter((p) => p.estado === "falta").length;
  return { fecha: d.fecha, listo: faltan === 0, faltan, avisos: puntos.filter((p) => p.estado === "aviso").length, puntos };
}

/** fecha "AAAA-MM-DD" o undefined para hoy. Permiso planes.ver, el mismo de la pantalla del plan. */
export async function obtenerPreparacion(ctx: Contexto, fecha?: unknown): Promise<Resultado<Preparacion>> {
  const permiso = permitir(ctx, "planes.ver");
  if (!permiso.ok) return permiso;
  const hoy = fechaEnMexico(ctx.ahora);
  const dia = fecha === undefined ? hoy : fechaSchema.safeParse(fecha).data;
  if (dia === undefined) return { ok: false, error: "invalido", campos: { fecha: ["Fecha no válida"] } };

  const datos = await leerInstantanea(ctx.bd, async (tx) => ({
    config: await leerConfiguracionCompleta(tx),
    solicitudes: await leerSolicitudesParaCola(tx, dia),
    clientes: await leerCartera(tx),
    jornadas: await leerJornadas(tx, dia),
    unidades: await leerUnidades(tx),
    operadores: await leerOperadores(tx),
    catalogoUnidad: await leerCatalogo(tx, "unidad"),
    catalogoOperador: await leerCatalogo(tx, "operador"),
  }));
  return { ok: true, valor: evaluarPreparacion({ ...datos, fecha: dia, hoy, minutoActual: minutoEnMexico(ctx.ahora) }) };
}
