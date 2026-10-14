import "server-only";

export interface AvisoPublicado { version: string; texto: string; publicadoEn: Date }

/** Sin sesión: la versión vigente del aviso integral, o null si aún no se publica ninguna con texto. */
export async function avisoVigente(): Promise<AvisoPublicado | null> {
  throw new Error("pendiente: Plan 2 T3 (Claude)");
}

/** Sin sesión: versiones publicadas con texto, de la más reciente a la más antigua. */
export async function historialAvisos(): Promise<{ version: string; publicadoEn: Date }[]> {
  throw new Error("pendiente: Plan 2 T3 (Claude)");
}
