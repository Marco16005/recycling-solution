// Usuarios sintéticos para las pruebas de punta a punta (Plan 1 v2, §3.5). Solo corre con E2E_SEMILLA_PERMITIDA=1,
// que únicamente define compose.test.yaml, para no tocar nunca una base de operación.
import { buscarPorCorreo, crearIdentidad, desactivarUsuario } from "../src/seguridad/identidades";
import type { Rol } from "../src/seguridad/permisos";
import { conBase, ejecutar } from "./comun";

const USUARIOS: { correo: string; rol: Rol; inactivo?: boolean }[] = [
  { correo: "admin@e2e.local", rol: "admin" },
  { correo: "despachador@e2e.local", rol: "despachador" },
  { correo: "despachador2@e2e.local", rol: "despachador" },
  { correo: "gerencia@e2e.local", rol: "gerencia" },
  { correo: "operador@e2e.local", rol: "operador" },
  { correo: "inactivo@e2e.local", rol: "despachador", inactivo: true },
  { correo: "baja@e2e.local", rol: "despachador" },
];

await ejecutar(async () => {
  if (process.env.E2E_SEMILLA_PERMITIDA !== "1") throw new Error("La semilla de pruebas solo corre en compose.test.yaml");
  const clave = process.env.E2E_CLAVE ?? "";
  await conBase(async (bd) => {
    for (const u of USUARIOS) {
      if (await buscarPorCorreo(bd, u.correo)) continue;
      await bd.transaction(async (tx) => {
        const { usuarioId } = await crearIdentidad(tx, { correo: u.correo, nombre: `E2E ${u.rol}`, clave, rol: u.rol }, null, new Date());
        if (u.inactivo) await desactivarUsuario(tx, usuarioId, null, new Date());
      });
    }
  });
  console.log(`Semilla de pruebas lista: ${USUARIOS.length} usuarios sintéticos.`);
});
