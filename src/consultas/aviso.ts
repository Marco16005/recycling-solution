import "server-only";
import { leerAvisosPublicados, leerConfiguracion } from "@/datos/configuracion";
import { bdDeLaAplicacion } from "@/datos/conexion";

export interface AvisoPublicado { version: string; texto: string; publicadoEn: Date }

/** Sin sesión: la versión vigente del aviso integral, o null si la vigente aún no tiene texto publicado. */
export async function avisoVigente(): Promise<AvisoPublicado | null> {
  const bd = bdDeLaAplicacion();
  const { versionAvisoPrivacidad } = await leerConfiguracion(bd);
  const vigente = (await leerAvisosPublicados(bd)).find((a) => a.version === versionAvisoPrivacidad);
  return vigente?.texto ? { version: vigente.version, texto: vigente.texto, publicadoEn: vigente.publicadoEn } : null;
}

/** Sin sesión: versiones publicadas con texto, de la más reciente a la más antigua. */
export async function historialAvisos(): Promise<{ version: string; publicadoEn: Date }[]> {
  return (await leerAvisosPublicados(bdDeLaAplicacion())).map((a) => ({ version: a.version, publicadoEn: a.publicadoEn }));
}
