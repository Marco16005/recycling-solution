import { z } from "zod";
import { clienteSchema } from "../clientes/esquemas";
import { ESTADOS_DOCUMENTO, TIPOS_UNIDAD } from "../clientes/tipos";
import { normalizarPlaca } from "./disponibilidad";
import type { OperadorEntrada, UnidadEntrada } from "./tipos";

const documentosSchema = z.array(z.object({
  tipoDocumentoId: z.string().trim().min(1, "Selecciona el tipo de documento"),
  obligatorio: z.boolean(),
  estado: z.enum(ESTADOS_DOCUMENTO),
  venceEl: z.iso.date("Usa una fecha real con formato AAAA-MM-DD").nullable(),
  notas: z.string().trim().max(500).nullable(),
})).superRefine((documentos, ctx) => {
  const tipos = new Set<string>();
  documentos.forEach((documento, indice) => {
    if (tipos.has(documento.tipoDocumentoId)) {
      ctx.addIssue({ code: "custom", path: [indice, "tipoDocumentoId"], message: "El tipo de documento está repetido" });
    }
    tipos.add(documento.tipoDocumentoId);
  });
});

export const unidadSchema: z.ZodType<UnidadEntrada> = z.object({
  placa: z.string().transform(normalizarPlaca).pipe(z.string().regex(/^[A-Z0-9]+$/, "Escribe una placa con letras y números")),
  numeroEconomico: z.string().trim().min(1).nullable(),
  tipo: z.enum(TIPOS_UNIDAD),
  capacidadKg: z.number().min(1).max(60000),
  rendimientoKmL: z.number().gt(0).max(50),
  activo: z.boolean(),
  notas: z.string().trim().max(500).nullable(),
  documentos: documentosSchema,
});

export const operadorSchema: z.ZodType<OperadorEntrada> = z.object({
  nombre: z.string().trim().min(2, "Escribe el nombre del operador").max(120),
  telefono: clienteSchema.shape.contactoTelefono,
  activo: z.boolean(),
  documentos: documentosSchema,
});
