import type { ClienteEntrada } from "./esquemas";
import type { ClienteGuardado } from "./tipos";

/** Valores iniciales del formulario de alta. */
export function clienteNuevo(): ClienteEntrada {
  return {
    nombre: "",
    contactoNombre: null,
    contactoTelefono: null,
    direccion: null,
    lat: null,
    lng: null,
    tipoResiduo: null,
    material: null,
    tiposUnidadAdmitidos: [],
    notasAcceso: null,
    tiempoServicioMin: 66,
    cargaEstimadaKg: null,
    activo: true,
    ventanas: [],
    documentos: [],
  };
}

/** Convierte un cliente guardado en los valores del formulario de edición. */
export function aEntrada(cliente: ClienteGuardado): ClienteEntrada {
  return {
    nombre: cliente.nombre,
    contactoNombre: cliente.contactoNombre,
    contactoTelefono: cliente.contactoTelefono,
    direccion: cliente.direccion,
    lat: cliente.lat,
    lng: cliente.lng,
    tipoResiduo: cliente.tipoResiduo,
    material: cliente.material,
    tiposUnidadAdmitidos: cliente.tiposUnidadAdmitidos,
    notasAcceso: cliente.notasAcceso,
    tiempoServicioMin: cliente.tiempoServicioMin,
    cargaEstimadaKg: cliente.cargaEstimadaKg,
    activo: cliente.activo,
    ventanas: cliente.ventanas,
    documentos: cliente.documentos,
  };
}
