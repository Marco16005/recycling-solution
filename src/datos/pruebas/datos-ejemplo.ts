import type { ClienteEntrada } from "@/dominio/clientes/esquemas";

/** Cliente sintético válido para pruebas de datos. */
export function clienteDePrueba(cambios: Partial<ClienteEntrada> = {}): ClienteEntrada {
  return {
    nombre: "Cartonera del Bajío",
    contactoNombre: "Laura Méndez",
    contactoTelefono: "442 555 0101",
    direccion: "Av. del Marqués 100, El Marqués, Qro.",
    lat: 20.6102,
    lng: -100.2801,
    tipoResiduo: "RME",
    material: "Cartón nacional",
    tiposUnidadAdmitidos: ["doble_rodada"],
    notasAcceso: "Registro en caseta",
    tiempoServicioMin: 66,
    cargaEstimadaKg: 1800,
    activo: true,
    ventanas: [{ diaSemana: 1, horaInicio: "08:00", horaFin: "12:00" }],
    documentos: [{ nombre: "SUA vigente", obligatorio: true, estado: "vigente", venceEl: "2026-12-31" }],
    ...cambios,
  };
}
