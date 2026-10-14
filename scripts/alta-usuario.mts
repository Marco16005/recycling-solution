// Alta de un usuario: --correo, --nombre y --rol (admin | despachador | operador | gerencia).
// La contraseña se toma de CLAVE_NUEVA; si no hay, se genera y se muestra una sola vez.
import { parseArgs } from "node:util";
import { crearIdentidad } from "../src/seguridad/identidades";
import { ROLES, type Rol } from "../src/seguridad/permisos";
import { claveAleatoria, conBase, ejecutar } from "./comun";

await ejecutar(async () => {
  const { values } = parseArgs({ options: { correo: { type: "string" }, nombre: { type: "string" }, rol: { type: "string" } } });
  if (!values.correo || !values.nombre || !ROLES.includes(values.rol as Rol)) {
    throw new Error(`Uso: alta-usuario --correo correo --nombre "Nombre" --rol ${ROLES.join("|")}`);
  }
  const clave = process.env.CLAVE_NUEVA || claveAleatoria();
  await conBase((bd) =>
    bd.transaction((tx) =>
      crearIdentidad(tx, { correo: values.correo!, nombre: values.nombre!, clave, rol: values.rol as Rol }, null, new Date()),
    ),
  );
  console.log(`Usuario ${values.correo} creado con rol ${values.rol}.`);
  if (!process.env.CLAVE_NUEVA) console.log(`Contraseña inicial (entrégala en persona): ${clave}`);
});
