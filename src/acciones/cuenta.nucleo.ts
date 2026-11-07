import { z } from "zod";
import { erroresPorCampo } from "@/dominio/clientes/esquemas";
import { cambiarClavePropia, CLAVE_MAXIMA, CLAVE_MINIMA } from "@/seguridad/identidades";
import { dentroDelLimite, MENSAJE_LIMITE } from "@/seguridad/limites";
import { permitir } from "./autorizacion";
import type { Contexto, Resultado } from "./tipos";
import { invalido } from "./validacion";

const LARGO = `Entre ${CLAVE_MINIMA} y ${CLAVE_MAXIMA} caracteres`;

/** La nueva no se recorta: los espacios cuentan como parte de la contraseña, igual que al entrar. */
export const cambioDeClaveSchema = z
  .object({
    actual: z.string().min(1, "Escribe tu contraseña actual").max(CLAVE_MAXIMA, "La contraseña actual no es correcta"),
    nueva: z.string().min(CLAVE_MINIMA, LARGO).max(CLAVE_MAXIMA, LARGO),
    confirmacion: z.string(),
  })
  .refine((d) => d.confirmacion === d.nueva, { path: ["confirmacion"], message: "No coincide con la nueva contraseña" })
  .refine((d) => d.nueva !== d.actual, { path: ["nueva"], message: "Debe ser distinta de la actual" });

/**
 * Cualquier usuario cambia su propia contraseña (diseño del 2026-11-07, §2.2). Verifica la actual, conserva la sesión
 * desde la que se pidió y cierra las demás. Es lo único que puede hacer quien entró con una contraseña temporal.
 * `obligatorio` dice si era temporal, para que la pantalla lleve al inicio.
 */
export async function cambiarMiClave(ctx: Contexto, sesionId: string | null, entrada: unknown): Promise<Resultado<{ obligatorio: boolean }>> {
  const permiso = permitir(ctx, "cuenta.cambiarClave");
  if (!permiso.ok) return permiso;
  if (sesionId === null) return { ok: false, error: "no_autenticado" };
  const datos = cambioDeClaveSchema.safeParse(entrada);
  if (!datos.success) return invalido(erroresPorCampo(datos.error));
  if (!dentroDelLimite("clave", permiso.usuario.id, ctx.ahora)) return invalido({ _: [MENSAJE_LIMITE] });
  const obligatorio = permiso.usuario.debeCambiarClave === true;
  return ctx.bd.transaction(async (tx) => {
    const r = await cambiarClavePropia(tx, permiso.usuario.id, { actual: datos.data.actual, nueva: datos.data.nueva, sesionId }, ctx.ahora);
    if (r === "sin_sesion") return { ok: false, error: "no_autenticado" };
    if (r === "clave_incorrecta") return invalido({ actual: ["La contraseña actual no es correcta"] });
    return { ok: true, valor: { obligatorio } };
  });
}
