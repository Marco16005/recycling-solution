// Desactiva a un usuario y borra sus sesiones: --correo. Con --reactivar lo vuelve a activar (sin revivir sesiones).
import { parseArgs } from "node:util";
import { buscarPorCorreo, desactivarUsuario, reactivarUsuario } from "../src/seguridad/identidades";
import { conBase, ejecutar } from "./comun";

await ejecutar(async () => {
  const { values } = parseArgs({ options: { correo: { type: "string" }, reactivar: { type: "boolean", default: false } } });
  if (!values.correo) throw new Error("Uso: desactivar-usuario --correo correo [--reactivar]");
  await conBase(async (bd) => {
    const existente = await buscarPorCorreo(bd, values.correo!);
    if (existente?.usuarioId == null) throw new Error(`No hay un usuario de la aplicación con el correo ${values.correo}`);
    const usuarioId = existente.usuarioId;
    await bd.transaction((tx) =>
      values.reactivar ? reactivarUsuario(tx, usuarioId, null, new Date()) : desactivarUsuario(tx, usuarioId, null, new Date()),
    );
  });
  console.log(values.reactivar ? `Usuario ${values.correo} reactivado.` : `Usuario ${values.correo} desactivado; sus sesiones se cerraron.`);
});
