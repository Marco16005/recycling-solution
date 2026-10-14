import type { EntradaPlan, SolicitudMotor, UnidadMotor } from "./tipos";

export const patio = { lat: 20.62, lng: -100.27 };
export function solicitud(id = "s1", cambios: Partial<SolicitudMotor> = {}): SolicitudMotor {
  return { id, folio: id, registradaEn: "2026-10-14T07:00:00-06:00", clienteId: `cliente-${id}`,
    ubicacion: { ...patio }, ventanas: [{ inicioMin: 480, finMin: 960 }], tiempoServicioMin: 20,
    cargaKg: 1000, tiposUnidadAdmitidos: ["doble_rodada"], ...cambios };
}
export function unidad(id = "u1", cambios: Partial<UnidadMotor> = {}): UnidadMotor {
  return { id, tipo: "doble_rodada", capacidadKg: 8000, ubicacionInicial: { ...patio },
    libreDesdeMin: 480, cargaActualKg: 0, ...cambios };
}
export function entrada(solicitudes = [solicitud()], unidades = [unidad()]): EntradaPlan {
  return { fecha: "2026-10-14", instanteMin: 480, solicitudes, unidades,
    parametros: { patio: { ...patio }, turnoInicioMin: 480, turnoFinMin: 960, velocidadKmh: 30,
      factorCircuidad: 1.3, descargaMin: 15, capacidadMaximaPorTipoKg: { doble_rodada: 8000, rabon: 12000, camioneta: 2000 }, semilla: 37 } };
}
