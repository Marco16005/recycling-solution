import { sql } from "drizzle-orm";
import type { BD } from "@/datos/bd";
import { buscarPorCorreo, crearIdentidad } from "./identidades";

const CANDADO_BOOTSTRAP = 727_003;

export type ResultadoBootstrap = "creado" | "ya_existe";

/**
 * Garantiza el primer administrador (especificación §10). Idempotente: si el correo ya es de un administrador no hace
 * nada (ni cambia su contraseña). Si el correo es de otra cuenta, falla y no la promueve.
 */
export async function asegurarAdministrador(
  bd: BD,
  datos: { correo: string; nombre: string; clave: string },
  ahora: Date,
): Promise<ResultadoBootstrap> {
  return bd.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${CANDADO_BOOTSTRAP})`);
    const existente = await buscarPorCorreo(tx, datos.correo);
    if (existente === null) {
      await crearIdentidad(tx, { ...datos, rol: "admin" }, null, ahora);
      return "creado";
    }
    if (existente.rol === "admin") return "ya_existe";
    throw new Error(
      existente.usuarioId === null
        ? "El correo pertenece a una identidad sin usuario de la aplicación; revísala a mano"
        : "El correo pertenece a una cuenta que no es de administrador; bootstrap no la promueve",
    );
  });
}
