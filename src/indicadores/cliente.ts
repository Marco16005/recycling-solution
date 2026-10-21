import type { Ritmo } from "@/dominio/solicitudes/propuestas";

/** Plan CRM, §4.5: números de un cliente en los últimos 90 días. Se implementa en PC-4. */
export interface NumerosCliente {
  completadas: number; noAtendidas: number; ultimaVisita: string | null; ritmo: Ritmo | null;
  vecesPospuesta: number; dentroDeHorario: { porcentaje: number | null; muestra: number };
}

export interface DatosNumerosCliente {
  paradas: { fecha: string; estado: string; llegadaEn: string | null; ventanaInicio: string; ventanaFin: string }[];
  solicitudes: { fechaSolicitada: string; estado: string; vecesPospuesta: number }[];
}

export function numerosDeCliente(datos: DatosNumerosCliente, hoy: string): NumerosCliente {
  void datos; void hoy;
  throw new Error("pendiente: PC-4");
}
