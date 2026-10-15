"use server";

import { revalidatePath } from "next/cache";
import type { Rol } from "@/seguridad/permisos";
import { contextoDeLaPeticion } from "@/seguridad/sesion";
import type { Resultado } from "./tipos";
import { cambiarRol, crearUsuario, darDeBajaUsuario, reactivarCuenta, restablecerClaveDeUsuario } from "./usuarios.nucleo";

const refrescar = <T>(r: Resultado<T>) => {
  if (r.ok) revalidatePath("/admin/usuarios");
  return r;
};

export async function crearUsuarioAccion(entrada: { correo: string; nombre: string; rol: Rol; operadorId: string | null }) {
  return refrescar(await crearUsuario(await contextoDeLaPeticion(), entrada));
}

export async function cambiarRolAccion(id: string, versionEsperada: number, entrada: { rol: Rol; operadorId: string | null }) {
  return refrescar(await cambiarRol(await contextoDeLaPeticion(), id, versionEsperada, entrada));
}

export async function darDeBajaAccion(id: string, versionEsperada: number) {
  return refrescar(await darDeBajaUsuario(await contextoDeLaPeticion(), id, versionEsperada));
}

export async function reactivarAccion(id: string, versionEsperada: number) {
  return refrescar(await reactivarCuenta(await contextoDeLaPeticion(), id, versionEsperada));
}

export async function restablecerClaveAccion(id: string, versionEsperada: number) {
  return refrescar(await restablecerClaveDeUsuario(await contextoDeLaPeticion(), id, versionEsperada));
}
