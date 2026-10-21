import type { BD } from "@/datos/bd";
import type { UsuarioSesion } from "@/seguridad/permisos";

/** Lo que reciben las acciones y consultas: base, usuario de la sesión y el instante de la petición. */
export interface Contexto {
  bd: BD;
  usuario: UsuarioSesion | null;
  ahora: Date;
  /** Hora actual para lo que se mide después de esperar un bloqueo (validar el plan). Si falta, se usa ahora. */
  reloj?: () => Date;
}

/** Por qué una operación del plan del día no pudo hacerse (Plan 4, §3.3). */
export type CodigoConflicto =
  | "plan_validado_existente"
  | "generacion_adelantada"
  | "datos_cambiaron"
  | "cliente_no_habilitado"
  | "capacidades_cambiaron"
  | "solicitud_asignada"
  | "hora_vencida"
  | "jornada_con_rutas"
  | "evento_distinto"
  | "ruta_cambiada"
  | "operacion_avanzo"
  | "frontera_vencida";

/** Un conflicto puede traer su motivo (texto para la pantalla); los conflictos de versión de los Planes 1 y 2 no lo traen. */
export type Resultado<T> =
  | { ok: true; valor: T }
  | { ok: false; error: "no_autenticado" | "no_autorizado" | "no_encontrado" }
  | { ok: false; error: "conflicto"; motivo?: { codigo: CodigoConflicto; texto: string } }
  | { ok: false; error: "invalido"; campos: Record<string, string[]> };
