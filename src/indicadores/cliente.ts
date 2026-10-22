import { ritmoAprendido, type Ritmo } from "@/dominio/solicitudes/propuestas";
import { inicioDentroDeVentana } from "./index";

/** Plan CRM, §4.5: números de un cliente en los últimos 90 días (el ritmo mira 180, como las propuestas). */
export interface NumerosCliente {
  completadas: number; noAtendidas: number; ultimaVisita: string | null; ritmo: Ritmo | null;
  vecesPospuesta: number; dentroDeHorario: { porcentaje: number | null; muestra: number };
}

export interface DatosNumerosCliente {
  /** dentroDeHorario usa el inicio de servicio, como K3: llegar antes y esperar cuenta como cumplimiento. */
  paradas: { fecha: string; estado: string; inicioServicioEn: string | null; ventanaInicio: string; ventanaFin: string }[];
  solicitudes: { fechaSolicitada: string; estado: string; vecesPospuesta: number }[];
}

export const VENTANA_NUMEROS_DIAS = 90;
const dia = (fecha: string) => Date.parse(`${fecha}T00:00:00Z`) / 86_400_000;

export function numerosDeCliente(datos: DatosNumerosCliente, hoy: string): NumerosCliente {
  const enVentana = (fecha: string) => dia(fecha) > dia(hoy) - VENTANA_NUMEROS_DIAS && dia(fecha) <= dia(hoy);
  const paradas = datos.paradas.filter((p) => enVentana(p.fecha));
  const completadas = paradas.filter((p) => p.estado === "completada");
  const evaluables = completadas.filter((p) => p.inicioServicioEn !== null);
  const dentro = evaluables.filter((p) => inicioDentroDeVentana(new Date(p.inicioServicioEn!), p.ventanaInicio, p.ventanaFin)).length;
  const visitas = datos.paradas.filter((p) => p.estado === "completada").map((p) => p.fecha).sort();
  return {
    completadas: completadas.length,
    noAtendidas: paradas.filter((p) => p.estado === "no_atendida").length,
    ultimaVisita: visitas.at(-1) ?? null,
    ritmo: ritmoAprendido(datos.solicitudes.filter((s) => s.estado === "atendida").map((s) => s.fechaSolicitada), hoy),
    vecesPospuesta: datos.solicitudes.filter((s) => enVentana(s.fechaSolicitada)).reduce((n, s) => n + s.vecesPospuesta, 0),
    dentroDeHorario: { porcentaje: evaluables.length ? Math.round((dentro / evaluables.length) * 1000) / 10 : null, muestra: evaluables.length },
  };
}
