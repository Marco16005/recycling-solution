// Crea el primer administrador con ADMIN_CORREO, ADMIN_NOMBRE y ADMIN_CLAVE. Idempotente (especificación §10).
import { asegurarAdministrador } from "../src/seguridad/bootstrap";
import { conBase, ejecutar } from "./comun";

await ejecutar(async () => {
  const correo = process.env.ADMIN_CORREO ?? "";
  if (correo === "") {
    console.log("Sin ADMIN_CORREO: no se crea administrador.");
    return;
  }
  const datos = { correo, nombre: process.env.ADMIN_NOMBRE || "Administrador", clave: process.env.ADMIN_CLAVE ?? "" };
  const resultado = await conBase((bd) => asegurarAdministrador(bd, datos, new Date()));
  console.log(resultado === "creado" ? `Administrador ${correo} creado.` : `El administrador ${correo} ya existía; no se cambió nada.`);
});
