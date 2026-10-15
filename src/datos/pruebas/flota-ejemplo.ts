import type { OperadorEntrada, UnidadEntrada } from "@/dominio/flota/tipos";

const vigente = (tipoDocumentoId: string) => ({ tipoDocumentoId, obligatorio: true, estado: "vigente" as const, venceEl: "2027-12-31", notas: null });

/** Unidad sintética con todos los documentos obligatorios del catálogo vigentes. */
export function unidadDePrueba(cambios: Partial<UnidadEntrada> = {}): UnidadEntrada {
  return {
    placa: "QRO1234",
    numeroEconomico: null,
    tipo: "doble_rodada",
    capacidadKg: 8000,
    rendimientoKmL: 3.5,
    activo: true,
    notas: null,
    documentos: ["tarjeta_circulacion", "poliza_responsabilidad_civil", "verificacion_vehicular", "registro_transporte_rme"].map(vigente),
    ...cambios,
  };
}

/** Operador sintético con licencia vigente (la entrega del aviso se registra aparte). */
export function operadorDePrueba(cambios: Partial<OperadorEntrada> = {}): OperadorEntrada {
  return { nombre: "Juan Operador", telefono: "442 555 0199", activo: true, documentos: [vigente("licencia_conducir")], ...cambios };
}
