import type { Faltante } from "./completitud";
import type { EstadoDocumento, TipoResiduo, TipoUnidad } from "./tipos";

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
