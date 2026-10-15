import { eq } from "drizzle-orm";
import type { BD } from "../bd";
import { insertarCliente } from "../clientes";
import { leerConfiguracion } from "../configuracion";
import { configuracion } from "../esquema";
import { insertarOperador, insertarUnidad, registrarEntregaAvisoSiVersion } from "../flota";
import { insertarJornada } from "../jornadas";
import { insertarMovimientoPrivacidad } from "../privacidad";
import { insertarSolicitud } from "../solicitudes";
import { clienteDePrueba } from "./datos-ejemplo";
import { operadorDePrueba, unidadDePrueba } from "./flota-ejemplo";

/** Jueves 2026-10-15 a las 07:00 en Ciudad de México (UTC−6): antes del turno de 08:00. */
export const AHORA_PLAN = new Date("2026-10-15T13:00:00Z");
export const FECHA_PLAN = "2026-10-15";
export const PATIO = { lat: 20.62, lng: -100.3 };

/** Ventana de lunes a sábado. */
const ventanas = (horaInicio: string, horaFin: string) => [1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, horaInicio, horaFin }));

export async function ponerPatio(bd: BD): Promise<void> {
  await bd.update(configuracion).set({ patioLat: PATIO.lat, patioLng: PATIO.lng, version: 2 }).where(eq(configuracion.id, 1));
}

/** Cliente habilitado (ubicación, ventana, residuo y privacidad aceptada) cerca del patio. */
export async function clienteHabilitado(bd: BD, nombre: string, desplazamiento: number, cambios: Parameters<typeof clienteDePrueba>[0] = {}) {
  const { versionAvisoPrivacidad } = await leerConfiguracion(bd);
  return bd.transaction(async (tx) => {
    const c = await insertarCliente(
      tx,
      clienteDePrueba({
        nombre, lat: PATIO.lat + desplazamiento, lng: PATIO.lng + desplazamiento, ventanas: ventanas("08:00", "14:00"),
        tiempoServicioMin: 20, cargaEstimadaKg: 800, documentos: [], ...cambios,
      }),
      AHORA_PLAN,
    );
    await insertarMovimientoPrivacidad(tx, { clienteId: c.id, versionAviso: versionAvisoPrivacidad, accion: "aceptado", medio: "papel", registradoPor: null, en: AHORA_PLAN });
    return c;
  });
}

/** Unidad y operador disponibles (documentos vigentes y aviso entregado) con jornada en la fecha. */
export async function jornadaDisponible(bd: BD, fecha: string, placa: string, cambiosUnidad: Parameters<typeof unidadDePrueba>[0] = {}) {
  const { versionAvisoPrivacidad } = await leerConfiguracion(bd);
  return bd.transaction(async (tx) => {
    const unidad = await insertarUnidad(tx, unidadDePrueba({ placa, ...cambiosUnidad }), AHORA_PLAN);
    const operador = await insertarOperador(tx, operadorDePrueba({ nombre: `Operador ${placa}` }), AHORA_PLAN);
    await registrarEntregaAvisoSiVersion(tx, operador.id, operador.version, versionAvisoPrivacidad, AHORA_PLAN);
    const jornadaId = await insertarJornada(tx, { fecha, unidadId: unidad.id, operadorId: operador.id, disponibleDesde: "08:00", notas: null }, AHORA_PLAN);
    return { unidadId: unidad.id, operadorId: operador.id, jornadaId };
  });
}

let consecutivo = 0;

/** Solicitud pendiente registrada a la hora dada (la llave FIFO). */
export async function solicitudPendiente(bd: BD, clienteId: string, registradoPor: string, fechaSolicitada: string, registradaEn = AHORA_PLAN) {
  consecutivo += 1;
  return bd.transaction((tx) =>
    insertarSolicitud(tx, {
      folio: `S-${fechaSolicitada.replaceAll("-", "")}-${String(consecutivo).padStart(3, "0")}`, clienteId, registradaEn, registradaPor: registradoPor,
      fechaSolicitada, canal: "telefono", cargaEstimadaKg: null, notas: null, capturaInicioEn: null, capturaFinEn: registradaEn,
    }),
  );
}
