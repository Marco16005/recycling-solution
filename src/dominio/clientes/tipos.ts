export const TIPOS_RESIDUO = ["RSU", "RME", "RP"] as const;
export type TipoResiduo = (typeof TIPOS_RESIDUO)[number];

export const TIPOS_UNIDAD = ["doble_rodada", "rabon", "camioneta"] as const;
export type TipoUnidad = (typeof TIPOS_UNIDAD)[number];

export const ESTADOS_DOCUMENTO = ["vigente", "pendiente", "vencido"] as const;
export type EstadoDocumento = (typeof ESTADOS_DOCUMENTO)[number];

export const ACCIONES_PRIVACIDAD = ["aceptado", "retirado"] as const;
export type AccionPrivacidad = (typeof ACCIONES_PRIVACIDAD)[number];

export const MEDIOS_PRIVACIDAD = ["papel", "correo", "verbal", "otro"] as const;
export type MedioPrivacidad = (typeof MEDIOS_PRIVACIDAD)[number];

/** Horas "HH:MM" (24 h). diaSemana: 0 = domingo … 6 = sábado. */
export interface Ventana {
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
}

/**
 * venceEl: fecha "AAAA-MM-DD" o null si no vence.
 * tipoDocumentoId: tipo del catálogo de clientes, o null/ausente si el nombre es libre (documentoSchema lo normaliza a null).
 */
export interface DocumentoCliente {
  nombre: string;
  obligatorio: boolean;
  estado: EstadoDocumento;
  venceEl: string | null;
  tipoDocumentoId?: string | null;
}

/** Último movimiento registrado del aviso de privacidad. id: el del renglón; sirve para detectar conflictos. */
export interface EstadoPrivacidad {
  id: string;
  accion: AccionPrivacidad;
  versionAviso: string;
  medio: MedioPrivacidad;
  en: Date;
}

/** Plan CRM: un contacto además del principal. */
export interface ContactoCliente { nombre: string; puesto: string | null; telefono: string | null; correo: string | null }
/** Plan CRM: día fijo opcional para proponer recolecciones. dias: 0 = domingo … 6 = sábado. */
export type Recurrencia =
  | { tipo: "dias_semana"; dias: number[] }
  | { tipo: "cada_n_dias"; cadaDias: number; desde: string };

export interface Cliente {
  nombre: string;
  contactoNombre: string | null;
  contactoTelefono: string | null;
  /** Plan CRM. */
  contactoCorreo: string | null;
  contactoPuesto: string | null;
  contactosAdicionales: ContactoCliente[];
  recurrencia: Recurrencia | null;
  direccion: string | null;
  lat: number | null;
  lng: number | null;
  tipoResiduo: TipoResiduo | null;
  material: string | null;
  tiposUnidadAdmitidos: TipoUnidad[];
  notasAcceso: string | null;
  tiempoServicioMin: number;
  cargaEstimadaKg: number | null;
  activo: boolean;
  ventanas: Ventana[];
  documentos: DocumentoCliente[];
  privacidad: EstadoPrivacidad | null;
}

export type ClienteGuardado = Cliente & { id: string; version: number };
