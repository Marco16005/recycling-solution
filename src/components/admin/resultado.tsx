import { notFound, redirect } from "next/navigation";
import type { Resultado } from "@/acciones/tipos";

type Fallo = Extract<Resultado<never>, { ok: false }>;

/** Traduce los fallos de autorización en navegación; devuelve los mensajes de los demás. */
export function mensajesDeFallo(r: Fallo): string[] {
  if (r.error === "no_autenticado") redirect("/entrar");
  if (r.error === "no_autorizado") redirect("/sin-acceso");
  if (r.error === "no_encontrado") notFound();
  if (r.error === "invalido") return Object.values(r.campos).flat();
  return ["Alguien más cambió este registro. Recarga la página y vuelve a intentarlo."];
}
