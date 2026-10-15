import { estadoEfectivo } from "../clientes/documentos";
import type { DocumentoRegistrado, MotivoNoDisponible, Operador, TipoDocumento, Unidad } from "./tipos";

function motivosDocumentos(documentos: DocumentoRegistrado[], catalogo: TipoDocumento[], aplicaA: "unidad" | "operador", fecha: string): MotivoNoDisponible[] {
  const faltantes: MotivoNoDisponible[] = [];
  const noVigentes: MotivoNoDisponible[] = [];
  for (const tipo of catalogo.filter((t) => t.aplicaA === aplicaA)) {
    const documento = documentos.find((d) => d.tipoDocumentoId === tipo.id);
    if (!documento) {
      if (tipo.obligatorioPorOmision) faltantes.push({ codigo: "documento_faltante", detalle: tipo.nombre });
    } else if (documento.obligatorio && estadoEfectivo({ ...documento, nombre: tipo.nombre }, fecha) !== "vigente") {
      noVigentes.push({ codigo: "documento_no_vigente", detalle: tipo.nombre });
    }
  }
  const porNombre = (a: MotivoNoDisponible, b: MotivoNoDisponible) => (a.detalle ?? "").localeCompare(b.detalle ?? "", "es");
  return [...faltantes.sort(porNombre), ...noVigentes.sort(porNombre)];
}

/** Orden: inactivo, documentos faltantes, documentos no vigentes; documentos por nombre. */
export function motivosNoDisponibleUnidad(u: Unidad, catalogo: TipoDocumento[], fecha: string): MotivoNoDisponible[] {
  return [
    ...(u.activo ? [] : [{ codigo: "inactivo" as const, detalle: null }]),
    ...motivosDocumentos(u.documentos, catalogo, "unidad", fecha),
  ];
}

/** La entrega del aviso se comprueba por su versión registrada. */
export function motivosNoDisponibleOperador(o: Operador, catalogo: TipoDocumento[], fecha: string): MotivoNoDisponible[] {
  return [
    ...(o.activo ? [] : [{ codigo: "inactivo" as const, detalle: null }]),
    ...motivosDocumentos(o.documentos, catalogo, "operador", fecha),
    ...(o.avisoVersion === null ? [{ codigo: "aviso_no_entregado" as const, detalle: null }] : []),
  ];
}

/** Intervalo inclusivo de fechas; independiente del estado capturado y de obligatoriedad. */
export function documentosPorVencer(docs: DocumentoRegistrado[], fecha: string, dias: number): DocumentoRegistrado[] {
  if (!Number.isInteger(dias) || dias < 0) throw new Error("Los días deben ser un entero no negativo");
  const limite = new Date(`${fecha}T00:00:00Z`);
  limite.setUTCDate(limite.getUTCDate() + dias);
  const hasta = limite.toISOString().slice(0, 10);
  return docs.filter((d) => d.venceEl !== null && d.venceEl >= fecha && d.venceEl <= hasta);
}

/** Mayúsculas, sin espacios ni guiones. */
export function normalizarPlaca(placa: string): string {
  return placa.toUpperCase().replace(/[\s-]/g, "");
}
