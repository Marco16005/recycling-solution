import { permitir } from "@/acciones/autorizacion";
import type { Contexto, Resultado } from "@/acciones/tipos";
import { COLUMNAS_CSV } from "@/dominio/clientes/csv";
import { documentoCsv } from "@/indicadores";
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

/** Fila de ejemplo de la plantilla: datos sintéticos, en el orden de COLUMNAS_CSV. */
const EJEMPLO: Record<(typeof COLUMNAS_CSV)[number], string> = {
  nombre: "Cartonera de Ejemplo", contacto: "Ana Ejemplo", telefono: "4420000000", direccion: "Av. Ejemplo 100, El Marqués",
  lat: "20.62", lng: "-100.3", residuo: "RME", material: "Cartón", servicio_min: "30", carga_kg: "800",
  horarios: "lun-vie 08:00-14:00; sab 09:00-12:00", tipos_unidad: "doble_rodada|rabon", notas_acceso: "Registrarse en caseta",
  ubicacion: "", correo: "ana@ejemplo.test", puesto: "Almacén",
};

/** Plan CRM, §4.1: plantilla para importar (permiso clientes.importar), con la misma forma que la exportación. */
export async function plantillaCsv(ctx: Contexto): Promise<Resultado<{ nombre: string; contenido: string }>> {
  const permiso = permitir(ctx, "clientes.importar");
  if (!permiso.ok) return permiso;
  return { ok: true, valor: { nombre: "plantilla-clientes.csv", contenido: documentoCsv(COLUMNAS_CSV, [COLUMNAS_CSV.map((c) => EJEMPLO[c])]) } };
}
