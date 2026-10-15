/**
 * Contrato del motor de ruteo (Plan 3, §3). Lo implementa Codex en src/motor; cambiarlo requiere acuerdo de ambos.
 * Tiempos: minutos enteros desde la medianoche de la fecha del plan (Ciudad de México). Distancias: km. Pesos: kg.
 */
import type { TipoUnidad } from "@/dominio/clientes/tipos";

export interface Coordenada { lat: number; lng: number }

export interface ParametrosMotor {
  patio: Coordenada;
  turnoInicioMin: number;        // de configuracion.turno_inicio (480 = 08:00 por omisión)
  turnoFinMin: number;           // de configuracion.turno_fin; incluye regreso y descarga
  velocidadKmh: number;
  factorCircuidad: number;
  descargaMin: number;           // al volver al patio, por viaje
  /** Mayor capacidad entre las unidades activas del catálogo de cada tipo, disponibles hoy o no. 0 si no hay de ese tipo. */
  capacidadMaximaPorTipoKg: Record<TipoUnidad, number>;
  semilla: number;
}

/** Limita el INICIO del servicio: se puede llegar antes y esperar a que abra; el servicio puede terminar después del fin. */
export interface VentanaMin { inicioMin: number; finMin: number }

export interface SolicitudMotor {
  id: string;
  folio: string;
  registradaEn: string;          // ISO 8601; llave FIFO junto con folio
  clienteId: string;
  ubicacion: Coordenada;
  ventanas: VentanaMin[];        // no vacía; el Plan 4 solo envía solicitudes habilitadas ese día
  tiempoServicioMin: number;
  cargaKg: number;               // ya resuelta con cargaEfectivaKg
  tiposUnidadAdmitidos: TipoUnidad[];
}

/**
 * Unidad tal como queda libre para el motor. En el plan del día: patio, disponibleDesde y carga 0.
 * En el re-ruteo (Plan 5), quien llama ya descontó todo lo congelado (paradas hechas, en sitio y el tramo en curso):
 * la unidad empieza donde y cuando termina lo congelado, con la carga que lleva.
 */
export interface UnidadMotor {
  id: string;                    // id de la jornada (unidad + operador del día)
  tipo: TipoUnidad;
  capacidadKg: number;
  ubicacionInicial: Coordenada;
  libreDesdeMin: number;
  cargaActualKg: number;         // > 0 solo en re-ruteo; ocupa el primer viaje
}

export interface EntradaPlan {
  fecha: string;                 // AAAA-MM-DD
  instanteMin: number;           // momento de la planificación; nada empieza antes
  solicitudes: SolicitudMotor[]; // sin repetidas; en re-ruteo, sin las congeladas
  unidades: UnidadMotor[];
  parametros: ParametrosMotor;
}

export interface ParadaPlan {
  solicitudId: string;
  secuencia: number;             // 1, 2, … dentro del viaje
  kmDesdeAnterior: number;
  llegadaMin: number;            // física
  esperaMin: number;             // inicioServicio − llegada
  inicioServicioMin: number;     // max(llegada, apertura de la ventana elegida); ≤ fin de esa ventana
  finServicioMin: number;
  ventana: VentanaMin;           // la ventana en la que cae el inicio
}

export interface ViajePlan {
  numero: number;                // 1, 2, … por unidad
  salidaMin: number;             // del patio, o de la ubicación inicial en el primer viaje del re-ruteo
  paradas: ParadaPlan[];         // puede estar vacía solo en el primer viaje del re-ruteo con carga: regreso y descarga
  regresoPatioMin: number;
  finDescargaMin: number;
  cargaKg: number;               // incluye cargaActualKg en el primer viaje
  km: number;                    // incluye el regreso al patio
}

export interface RutaPlan { unidadId: string; viajes: ViajePlan[] }

export type MotivoPospuesta =
  | "sin_unidades_disponibles"   // no hay ninguna unidad
  | "sin_unidad_compatible"      // ninguna unidad disponible es de un tipo admitido
  | "sin_cupo"                   // no cabe en ninguna posición factible
  | "pospuesta_a_mano";          // solo ajuste del despachador, con diagnostico null
export type MotivoBloqueoMotor = "carga_mayor_a_capacidad_compatible"; // > máximo de capacidadMaximaPorTipoKg entre sus tipos admitidos

/** Por qué se descartaron las posiciones probadas para una pospuesta "sin_cupo" (cuántas por cada razón). */
export interface Diagnostico { capacidad: number; ventana: number; finDeTurno: number; afectaAOtra: number }

/** Una decisión de admisión, en orden FIFO, con el estado de las rutas justo ANTES de tomarla. */
export type DecisionTraza =
  | { solicitudId: string; resultado: "admitida"; unidadId: string; viaje: number; secuencia: number; rutasAntes: RutaPlan[] }
  | { solicitudId: string; resultado: "pospuesta"; motivo: MotivoPospuesta; diagnostico: Diagnostico; rutasAntes: RutaPlan[] }
  | { solicitudId: string; resultado: "bloqueada"; motivo: MotivoBloqueoMotor };

export interface Plan {
  versionMotor: string;          // "1.0.0"
  rutas: RutaPlan[];
  pospuestas: { solicitudId: string; motivo: MotivoPospuesta; diagnostico: Diagnostico | null }[];
  bloqueadas: { solicitudId: string; motivo: MotivoBloqueoMotor }[];
  traza: DecisionTraza[];
  resumen: {
    ruteadas: number; pospuestas: number; bloqueadas: number;
    km: number; minutosTraslado: number;
    /** Un viaje redondo patio–cliente–patio por cada solicitud RUTEADA; compara las mismas solicitudes. */
    kmMetodoActual: number; minutosTrasladoMetodoActual: number;
  };
}

/** viaje y posicion se interpretan después de retirar la solicitud; viaje n+1 abre uno nuevo. */
export type AjusteManual =
  | { tipo: "mover"; solicitudId: string; unidadId: string; viaje: number; posicion: number }
  | { tipo: "posponer"; solicitudId: string }
  | { tipo: "actualizarHora"; instanteMin: number };

export type CausaNoFactible = "capacidad" | "ventana" | "finDeTurno" | "tipoNoAdmitido";

export type ResultadoRecalculo =
  | { ok: true; ruta: RutaPlan }
  | { ok: false; error: "entrada_invalida"; detalle: string }
  | { ok: false; error: "no_factible"; causa: CausaNoFactible; viaje: number; solicitudId: string | null };

/** entrada cambia solo con actualizarHora: instanteMin nuevo y libreDesdeMin = max(el anterior, instanteMin). */
export type ResultadoAjuste =
  | { ok: true; plan: Plan; entrada: EntradaPlan }
  | { ok: false; error: "entrada_invalida"; detalle: string }
  | { ok: false; error: "no_factible"; causa: CausaNoFactible; unidadId: string; viaje: number; solicitudId: string | null };
