import { z } from "zod";
import type { OperadorEntrada, UnidadEntrada } from "./tipos";

/** Pendiente: Plan 2 T2 (Codex). Debe validar y normalizar la placa, capacidad 1–60000, rendimiento > 0 y ≤ 50, documentos sin tipos repetidos. */
export const unidadSchema: z.ZodType<UnidadEntrada> = z.custom<UnidadEntrada>(() => {
  throw new Error("pendiente: Plan 2 T2 (Codex)");
});

/** Pendiente: Plan 2 T2 (Codex). Teléfono con la regla de clientes; documentos sin tipos repetidos. */
export const operadorSchema: z.ZodType<OperadorEntrada> = z.custom<OperadorEntrada>(() => {
  throw new Error("pendiente: Plan 2 T2 (Codex)");
});
