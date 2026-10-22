// Suprime las notas de seguimiento de un cliente cuando lo pide con un derecho ARCO (docs/legal/procedimiento-datos-personales.md).
//   docker compose run --rm migrate npx tsx scripts/suprimir-notas-cliente.mts --cliente <uuid> --solicitud "folio ARCO"
// Usa la conexión del migrador (la aplicación no puede borrar notas) y deja el renglón en la bitácora, sin el texto.
import { parseArgs } from "node:util";
import { registrarEvento } from "../src/datos/bitacora";
import { crearConexion } from "../src/datos/conexion-base";
import { suprimirNotasDeCliente } from "../src/datos/notas";
import { ejecutar } from "./comun";

await ejecutar(async () => {
  const { values } = parseArgs({ options: { cliente: { type: "string" }, solicitud: { type: "string" } } });
  if (!values.cliente || !/^[0-9a-f-]{36}$/i.test(values.cliente) || !values.solicitud?.trim())
    throw new Error('Uso: suprimir-notas-cliente --cliente <uuid> --solicitud "folio de la solicitud ARCO"');
  const url = process.env.MIGRADOR_DATABASE_URL;
  if (!url) throw new Error("Falta MIGRADOR_DATABASE_URL (corre el script en el servicio migrate)");
  const { bd, cerrar } = crearConexion(url, 1);
  try {
    const borradas = await bd.transaction(async (tx) => {
      const n = await suprimirNotasDeCliente(tx, values.cliente!);
      await registrarEvento(tx, { usuarioId: null, entidad: "cliente", entidadId: values.cliente!, accion: "suprimir_notas_arco", campos: ["notas"] });
      return n;
    });
    console.log(`Notas suprimidas: ${borradas}. Anota la solicitud ARCO "${values.solicitud}" en el registro del procedimiento.`);
  } finally {
    await cerrar();
  }
});
