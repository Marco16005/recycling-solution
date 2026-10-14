import type { Contexto, Resultado } from "@/acciones/tipos";
import type { Faltante, ResumenK5 } from "@/dominio/clientes/completitud";
import type { MotivoBloqueo } from "@/dominio/clientes/habilitacion";
import type { ClienteGuardado, TipoResiduo } from "@/dominio/clientes/tipos";

export interface ClienteResumen {
  id: string;
  nombre: string;
  direccion: string | null;
  tipoResiduo: TipoResiduo | null;
  activo: boolean;
  faltantes: Faltante[];
  completo: boolean;
  motivosHoy: MotivoBloqueo[];
}

/** fecha: hoy en Ciudad de México. k5: sobre toda la cartera, sin importar el filtro. */
export interface ListadoClientes {
  fecha: string;
  k5: ResumenK5;
  clientes: ClienteResumen[];
  puedeEditar: boolean;
}

export interface FichaCliente {
  cliente: ClienteGuardado;
  faltantes: Faltante[];
  motivosHoy: MotivoBloqueo[];
  versionAvisoVigente: string;
  puedeEditar: boolean;
  estiloMapaUrl: string;
}

/** Lo que necesita la pantalla de alta. */
export interface ContextoAlta {
  estiloMapaUrl: string;
  versionAvisoVigente: string;
}

/** Permiso clientes.ver. filtro: { texto?: string }. */
export async function listarClientes(ctx: Contexto, filtro: unknown): Promise<Resultado<ListadoClientes>> {
  void ctx;
  void filtro;
  throw new Error("pendiente: T4 (Claude)");
}

/** Permiso clientes.ver. */
export async function obtenerFicha(ctx: Contexto, id: unknown): Promise<Resultado<FichaCliente>> {
  void ctx;
  void id;
  throw new Error("pendiente: T4 (Claude)");
}

/** Permiso clientes.editar. */
export async function obtenerContextoAlta(ctx: Contexto): Promise<Resultado<ContextoAlta>> {
  void ctx;
  throw new Error("pendiente: T4 (Claude)");
}
