import { z } from "zod";
import type { Resultado } from "./tipos";

/** Validaciones comunes de id y versión de las acciones de edición. */
export const idSchema = z.uuid();
export const versionSchema = z.number().int().positive();
export const fechaSchema = z.iso.date();

export type Fallo = Extract<Resultado<never>, { ok: false }>;

export const invalido = (campos: Record<string, string[]>): Fallo => ({ ok: false, error: "invalido", campos });

/**
 * id null crea (versionEsperada debe ser null); un id debe ser uuid y traer versión. Devuelve el fallo o los valores.
 */
export function validarIdYVersion(
  id: unknown,
  versionEsperada: unknown,
): { ok: true; id: string | null; version: number | null } | Fallo {
  if (id !== null && !idSchema.safeParse(id).success) return { ok: false, error: "no_encontrado" };
  if (id === null) {
    return versionEsperada === null ? { ok: true, id: null, version: null } : invalido({ _: ["Un registro nuevo no lleva versión"] });
  }
  const version = versionSchema.safeParse(versionEsperada);
  if (!version.success) return invalido({ _: ["Falta la versión del registro que se editó"] });
  return { ok: true, id: id as string, version: version.data };
}

/** true si el error es una violación de unicidad de Postgres (código 23505), directa o como causa. */
export function esDuplicado(error: unknown): boolean {
  const codigo = (e: unknown) => (e as { code?: string } | null)?.code;
  return codigo(error) === "23505" || codigo((error as { cause?: unknown } | null)?.cause) === "23505";
}
