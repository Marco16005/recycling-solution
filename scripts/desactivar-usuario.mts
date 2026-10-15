// Desactiva a un usuario y borra sus sesiones: --correo. Con --reactivar lo vuelve a activar (sin revivir sesiones).
// No desactiva al último administrador activo.
import { parseArgs } from "node:util";
import { cambiarActivoPorScript } from "../src/seguridad/bajas-por-script";
import { buscarPorCorreo } from "../src/seguridad/identidades";
import { conBase, ejecutar } from "./comun";

await ejecutar(async () => {
  const { values } = parseArgs({ options: { correo: { type: "string" }, reactivar: { type: "boolean", default: false } } });
  if (!values.correo) throw new Error("Uso: desactivar-usuario --correo correo [--reactivar]");
  await conBase(async (bd) => {
    const existente = await buscarPorCorreo(bd, values.correo!);
    if (existente?.usuarioId == null) throw new Error(`No hay un usuario de la aplicación con el correo ${values.correo}`);
    const usuarioId = existente.usuarioId;
    const resultado = await bd.transaction((tx) => cambiarActivoPorScript(tx, usuarioId, values.reactivar, new Date()));
    if (resultado === "ultimo_admin") throw new Error("No se desactivó: es el último administrador activo");
    if (resultado === "no_encontrado") throw new Error(`No hay un usuario de la aplicación con el correo ${values.correo}`);
  });
  console.log(values.reactivar ? `Usuario ${values.correo} reactivado.` : `Usuario ${values.correo} desactivado; sus sesiones se cerraron.`);
});
