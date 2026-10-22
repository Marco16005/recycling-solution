import { z } from "zod";
import { CANALES_CAPTURA, type SolicitudEntrada } from "./tipos";

export const solicitudSchema: z.ZodType<SolicitudEntrada> = z.object({
  clienteId: z.uuid("Selecciona un cliente válido"),
  fechaSolicitada: z.iso.date("Usa una fecha real con formato AAAA-MM-DD"),
  canal: z.enum(CANALES_CAPTURA),
  cargaEstimadaKg: z.number().min(1).max(60000).nullable(),
  notas: z.string().trim().max(500).nullable(),
  capturaInicioEn: z.date().nullable(),
});
