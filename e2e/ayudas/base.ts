import { desactivarUsuario, buscarPorCorreo } from "../../src/seguridad/identidades";
import { crearConexion } from "../../src/datos/conexion-base";
import { USUARIOS_E2E, type UsuarioE2E } from "./sesion";

/** Desactiva a un usuario de la semilla como lo haría el administrador (borra sus sesiones). */
export async function desactivar(usuario: UsuarioE2E): Promise<void> {
  const { bd, cerrar } = crearConexion(process.env.DATABASE_URL ?? "", 1);
  try {
    const existente = await buscarPorCorreo(bd, USUARIOS_E2E[usuario]);
    if (existente?.usuarioId == null) throw new Error(`No existe ${usuario} en la semilla`);
    const usuarioId = existente.usuarioId;
    await bd.transaction((tx) => desactivarUsuario(tx, usuarioId, null, new Date()));
  } finally {
    await cerrar();
  }
}
