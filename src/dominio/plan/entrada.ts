/* eslint-disable @typescript-eslint/no-unused-vars -- Contratos pendientes de implementar en P2. */
import type { EntradaPlan, Plan, VentanaMin } from "@/motor/tipos";
import type { Cliente, ClienteGuardado, TipoUnidad } from "../clientes/tipos";
import type { UnidadGuardada } from "../flota/tipos";
import type { SolicitudGuardada } from "../solicitudes/tipos";
import type { ConfiguracionPlan, JornadaParaPlan } from "./tipos";

/** Acepta HH:MM y HH:MM:SS. */
export function minutosDeHora(hhmm: string): number {
  throw new Error("pendiente");
}

/** AAAAMMDD como entero. */
export function semillaDeFecha(fecha: string): number {
  throw new Error("pendiente");
}

/** Minuto en Ciudad de México, redondeado hacia arriba si hay segundos; zona explícita con Intl. */
export function minutoEnMexico(instante: Date): number {
  throw new Error("pendiente");
}

/** Instante de fecha + minutos en Ciudad de México, sin desfases fijos. */
export function instanteDeMinutos(fecha: string, minutos: number): Date {
  throw new Error("pendiente");
}

/** Ventanas para el día de la semana de fecha, en minutos. */
export function ventanasDelDia(cliente: Cliente, fecha: string): VentanaMin[] {
  throw new Error("pendiente");
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
  throw new Error("pendiente");
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
  throw new Error("pendiente");
}

export const TIPOS_REQUISITO_OPERADOR = ["induccion_seguridad_cliente"] as const;

/** Clientes por jornada cuyos requisitos de acceso dependen del operador. */
export function requisitosPorJornada(
  plan: Plan,
  clientesPorSolicitud: Map<string, ClienteGuardado>,
): Map<string, { clienteId: string; nombre: string; tipos: string[] }[]> {
  throw new Error("pendiente");
}
