import { z } from "zod";
import type { SolicitudEntrada } from "./tipos";

/** Pendiente: Plan 2 T2 (Codex). clienteId uuid, fecha real, canal del catálogo, carga 1–60000 o null, notas ≤ 500. */
export const solicitudSchema: z.ZodType<SolicitudEntrada> = z.custom<SolicitudEntrada>(() => {
  throw new Error("pendiente: Plan 2 T2 (Codex)");
});
