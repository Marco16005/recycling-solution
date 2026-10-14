// Restablece la contraseña de un usuario y cierra sus sesiones: --correo.
// La nueva se toma de CLAVE_NUEVA; si no hay, se genera y se muestra una sola vez.
import { parseArgs } from "node:util";
import { buscarPorCorreo, restablecerClave } from "../src/seguridad/identidades";
import { claveAleatoria, conBase, ejecutar } from "./comun";

await ejecutar(async () => {
  const { values } = parseArgs({ options: { correo: { type: "string" } } });
  if (!values.correo) throw new Error("Uso: restablecer-clave --correo correo");
  const clave = process.env.CLAVE_NUEVA || claveAleatoria();
  await conBase(async (bd) => {
    const existente = await buscarPorCorreo(bd, values.correo!);
    if (existente?.usuarioId == null) throw new Error(`No hay un usuario de la aplicación con el correo ${values.correo}`);
    const usuarioId = existente.usuarioId;
    await bd.transaction((tx) => restablecerClave(tx, usuarioId, clave, null, new Date()));
  });
  console.log(`Contraseña de ${values.correo} restablecida; sus sesiones se cerraron.`);
  if (!process.env.CLAVE_NUEVA) console.log(`Contraseña nueva (entrégala en persona): ${clave}`);
});
