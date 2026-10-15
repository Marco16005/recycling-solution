// Toma la instantánea diaria de K5 (clientes activos completos ÷ activos) si todavía no hay una de hoy (Plan 6).
// El cron del VPS la corre junto al respaldo de las 17:00 (docs/operacion.md §9).
import { leerCartera } from "../src/datos/clientes";
import { leerConfiguracionCompleta } from "../src/datos/configuracion";
import { tomarInstantaneaK5 } from "../src/datos/indicadores";
import { resumenK5 } from "../src/dominio/clientes/completitud";
import { fechaEnMexico } from "../src/dominio/tiempo";
import { conBase, ejecutar } from "./comun";

await ejecutar(async () => {
  const ahora = new Date();
  const fecha = fechaEnMexico(ahora);
  const tomada = await conBase((bd) =>
    bd.transaction(async (tx) => {
      const { versionAvisoPrivacidad } = await leerConfiguracionCompleta(tx);
      const k = resumenK5(await leerCartera(tx), versionAvisoPrivacidad);
      return tomarInstantaneaK5(tx, fecha, k.activos, k.completos, ahora);
    }),
  );
  console.log(tomada ? `Instantánea de K5 del ${fecha} guardada.` : `Ya había una instantánea de K5 del ${fecha}.`);
});
