import type { Contexto, Resultado } from "@/acciones/tipos";
import type { TipoUnidad } from "@/dominio/clientes/tipos";
import type {
  DocumentoRegistrado, MotivoNoDisponible, OperadorGuardado, TipoDocumento, UnidadGuardada,
} from "@/dominio/flota/tipos";

export interface UnidadResumen { id: string; placa: string; numeroEconomico: string | null; tipo: TipoUnidad; capacidadKg: number; activo: boolean }
export interface OperadorResumen { id: string; nombre: string; activo: boolean }

/** motivos y porVencer se calculan para la fecha de la consulta (hoy en Ciudad de México); porVencer: 30 días. */
export type FilaUnidad = UnidadGuardada & { motivos: MotivoNoDisponible[]; porVencer: DocumentoRegistrado[] };
export type FilaOperador = OperadorGuardado & { motivos: MotivoNoDisponible[]; porVencer: DocumentoRegistrado[] };

export interface ListadoUnidades { fecha: string; unidades: FilaUnidad[]; catalogo: TipoDocumento[]; puedeEditar: boolean }
export interface ListadoOperadores { fecha: string; operadores: FilaOperador[]; catalogo: TipoDocumento[]; puedeEditar: boolean }
export interface FichaUnidad { fecha: string; unidad: FilaUnidad; catalogo: TipoDocumento[]; puedeEditar: boolean }
export interface FichaOperador {
  fecha: string; operador: FilaOperador; catalogo: TipoDocumento[]; puedeEditar: boolean; versionAvisoVigente: string;
}
/** Para las pantallas de alta: el catálogo de la entidad y, en operadores, la versión vigente del aviso. */
export interface ContextoAltaFlota { catalogoUnidad: TipoDocumento[]; catalogoOperador: TipoDocumento[]; versionAvisoVigente: string }

/** Permiso flota.ver. filtro: { texto?: string; incluirInactivas?: boolean }; texto busca en placa y número económico. */
export async function listarUnidades(ctx: Contexto, filtro: unknown): Promise<Resultado<ListadoUnidades>> {
  void ctx; void filtro;
  throw new Error("pendiente: Plan 2 T3 (Claude)");
}

/** Permiso flota.ver. filtro: { texto?: string; incluirInactivos?: boolean }; texto busca en el nombre sin acentos. */
export async function listarOperadores(ctx: Contexto, filtro: unknown): Promise<Resultado<ListadoOperadores>> {
  void ctx; void filtro;
  throw new Error("pendiente: Plan 2 T3 (Claude)");
}

/** Permiso flota.ver. */
export async function obtenerUnidad(ctx: Contexto, id: unknown): Promise<Resultado<FichaUnidad>> {
  void ctx; void id;
  throw new Error("pendiente: Plan 2 T3 (Claude)");
}

/** Permiso flota.ver. */
export async function obtenerOperador(ctx: Contexto, id: unknown): Promise<Resultado<FichaOperador>> {
  void ctx; void id;
  throw new Error("pendiente: Plan 2 T3 (Claude)");
}

/** Permiso flota.editar. */
export async function contextoAltaFlota(ctx: Contexto): Promise<Resultado<ContextoAltaFlota>> {
  void ctx;
  throw new Error("pendiente: Plan 2 T3 (Claude)");
}
