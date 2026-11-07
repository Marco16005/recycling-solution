"use server";

import { contextoConSesion } from "@/seguridad/sesion";
import { cambiarMiClave } from "./cuenta.nucleo";

export async function cambiarMiClaveAccion(entrada: { actual: string; nueva: string; confirmacion: string }) {
  const { ctx, sesionId } = await contextoConSesion();
  return cambiarMiClave(ctx, sesionId, entrada);
}
