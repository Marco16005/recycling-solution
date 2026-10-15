import type { Faltante } from "./completitud";
import type { CodigoNoDisponible } from "../flota/tipos";
import type { Canal, EstadoSolicitud } from "../solicitudes/tipos";
import type { CodigoBloqueo } from "./habilitacion";
import type { AccionPrivacidad, MedioPrivacidad, EstadoDocumento, TipoResiduo, TipoUnidad } from "./tipos";

export const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"] as const;

export const ETIQUETA_FALTANTE: Record<Faltante, string> = {
  ubicacion: "Falta ubicación",
  ventana: "Falta ventana horaria",
  tipo_residuo: "Falta tipo de residuo",
  tipos_unidad: "Faltan unidades admitidas",
  aviso_privacidad: "Falta aviso de privacidad",
};

export const ETIQUETA_RESIDUO: Record<TipoResiduo, string> = {
  RSU: "Sólidos urbanos (RSU)",
  RME: "Manejo especial (RME)",
  RP: "Peligrosos (RP)",
};

export const ETIQUETA_UNIDAD: Record<TipoUnidad, string> = {
  doble_rodada: "Doble rodada",
  rabon: "Rabón",
  camioneta: "Camioneta",
};

export const ETIQUETA_ESTADO_DOCUMENTO: Record<EstadoDocumento, string> = {
  vigente: "Vigente",
  pendiente: "Pendiente",
  vencido: "Vencido",
};

export const ETIQUETA_BLOQUEO: Record<CodigoBloqueo, string> = {
  inactivo: "Cliente inactivo",
  sin_ubicacion: "Falta ubicación",
  residuo_no_definido: "Falta tipo de residuo",
  residuo_peligroso: "Residuo peligroso",
  documento_no_vigente: "Documento obligatorio no vigente",
  sin_aviso_privacidad: "Falta aviso vigente sin oposición del contacto",
  sin_ventana_ese_dia: "Sin ventana horaria ese día",
  sin_tipos_unidad: "Faltan tipos de unidad admitidos",
};

export const ETIQUETA_ACCION_PRIVACIDAD: Record<AccionPrivacidad, string> = {
  aceptado: "Aviso dado a conocer sin oposición",
  retirado: "Consentimiento revocado",
};

export const ETIQUETA_MEDIO_PRIVACIDAD: Record<MedioPrivacidad, string> = {
  papel: "Papel",
  correo: "Correo electrónico",
  verbal: "Verbal",
  otro: "Otro",
};

export const ETIQUETA_NO_DISPONIBLE: Record<CodigoNoDisponible, string> = {
  inactivo: "Inactivo",
  documento_faltante: "Falta documento obligatorio",
  documento_no_vigente: "Documento obligatorio no vigente",
  aviso_no_entregado: "Aviso de privacidad no entregado",
};

export const ETIQUETA_CANAL: Record<Canal, string> = {
  telefono: "Teléfono",
  whatsapp: "WhatsApp",
  correo: "Correo electrónico",
  presencial: "Presencial",
  otro: "Otro",
};

export const ETIQUETA_ESTADO_SOLICITUD: Record<EstadoSolicitud, string> = {
  pendiente: "Pendiente",
  cancelada: "Cancelada",
  atendida: "Atendida",
  no_atendida: "No atendida",
  programada: "Programada",
  en_ruta: "En ruta",
};
