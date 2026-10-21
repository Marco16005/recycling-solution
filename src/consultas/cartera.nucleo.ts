import type { Contexto, Resultado } from "@/acciones/tipos";
import type { TipoNota } from "@/acciones/cartera.nucleo";
import type { TipoResiduo } from "@/dominio/clientes/tipos";
import type { Propuesta, Ritmo } from "@/dominio/solicitudes/propuestas";
import type { NumerosCliente } from "@/indicadores/cliente";

/** Plan CRM, §4.3 a §4.6 y §4.10. Se implementa en PC-4. */

export interface FiltrosCartera {
  texto?: string; residuo?: TipoResiduo; estado?: "completo" | "incompleto" | "habilitado" | "no_habilitado";
  sinUbicacion?: boolean; documentos?: "por_vencer" | "vencidos"; activos?: "activos" | "inactivos" | "todos";
}

export interface NotaVista { id: string; tipo: TipoNota; texto: string; autor: string; en: Date; corregida: boolean }
export interface HistorialCliente {
  solicitudes: { id: string; folio: string; fechaSolicitada: string; canal: string; estado: string; motivo: string | null }[];
  recolecciones: { fecha: string; placa: string; llegadaEn: Date | null; dentroDeHorario: boolean | null; estado: "completada" | "no_atendida"; motivo: string | null }[];
  pagina: number; hayMas: boolean;
}
/** Lo que agrega la ficha del Plan CRM (permiso clientes.ver). */
export interface FichaCartera { historial: HistorialCliente; numeros: NumerosCliente; notas: NotaVista[]; ritmo: Ritmo | null; puedeAnotar: boolean }

export async function fichaCartera(ctx: Contexto, clienteId: unknown, pagina?: unknown): Promise<Resultado<FichaCartera>> {
  void ctx; void clienteId; void pagina;
  throw new Error("pendiente: PC-4");
}

export async function propuestasDeRecoleccion(ctx: Contexto, fecha?: unknown): Promise<Resultado<{ fecha: string;
  propuestas: (Propuesta & { nombre: string; ultimaSolicitud: string | null })[]; puedeConfirmar: boolean }>> {
  void ctx; void fecha;
  throw new Error("pendiente: PC-4");
}

export interface PuntoCartera { clienteId: string; nombre: string; lat: number; lng: number; estado: "completo_habilitado" | "incompleto" | "no_habilitado" }
export async function mapaCartera(ctx: Contexto, filtros: unknown):
  Promise<Resultado<{ puntos: PuntoCartera[]; sinUbicacion: number; estiloMapaUrl: string }>> {
  void ctx; void filtros;
  throw new Error("pendiente: PC-4");
}
