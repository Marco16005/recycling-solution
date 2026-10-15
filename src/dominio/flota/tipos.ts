import type { EstadoDocumento, TipoUnidad } from "../clientes/tipos";

export const APLICA_DOCUMENTO = ["cliente", "unidad", "operador"] as const;
export type AplicaDocumento = (typeof APLICA_DOCUMENTO)[number];

export const ORIGEN_DOCUMENTO = ["ley", "contrato", "politica"] as const;
export type OrigenDocumento = (typeof ORIGEN_DOCUMENTO)[number];

/** Entrada del catálogo (tabla tipos_documento). */
export interface TipoDocumento {
  id: string;
  nombre: string;
  aplicaA: AplicaDocumento;
  origen: OrigenDocumento;
  obligatorioPorOmision: boolean;
  requiereVencimiento: boolean;
  descripcion: string;
}

/**
 * Documento de una unidad u operador. obligatorio: el de esa entidad (se inicia con el del catálogo).
 * Un tipo obligatorio por omisión sin renglón cuenta como faltante. venceEl: "AAAA-MM-DD" o null.
 */
export interface DocumentoRegistrado {
  tipoDocumentoId: string;
  obligatorio: boolean;
  estado: EstadoDocumento;
  venceEl: string | null;
  notas: string | null;
}

export interface Unidad {
  /** Normalizada con normalizarPlaca. */
  placa: string;
  numeroEconomico: string | null;
  tipo: TipoUnidad;
  capacidadKg: number;
  rendimientoKmL: number;
  activo: boolean;
  notas: string | null;
  documentos: DocumentoRegistrado[];
}

export interface Operador {
  nombre: string;
  telefono: string | null;
  activo: boolean;
  /** Versión del aviso de privacidad entregada al operador y cuándo; ambos null si no se ha entregado. */
  avisoVersion: string | null;
  avisoEntregadoEn: Date | null;
  documentos: DocumentoRegistrado[];
}

export type UnidadGuardada = Unidad & { id: string; version: number };
export type OperadorGuardado = Operador & { id: string; version: number };

/** Entradas de los formularios (sin id ni versión). La entrega del aviso al operador se registra con su propia acción. */
export type UnidadEntrada = Unidad;
export type OperadorEntrada = Omit<Operador, "avisoVersion" | "avisoEntregadoEn">;

export type CodigoNoDisponible = "inactivo" | "documento_faltante" | "documento_no_vigente" | "aviso_no_entregado";

/** detalle: nombre del documento, o null. */
export interface MotivoNoDisponible {
  codigo: CodigoNoDisponible;
  detalle: string | null;
}
