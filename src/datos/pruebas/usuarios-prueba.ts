import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { UsuarioSesion, Rol } from "@/seguridad/permisos";
import type { BD } from "../bd";
import { user, usuarios } from "../esquema";

/** Usuario sintético con su identidad mínima (sin credencial), para probar acciones y consultas. */
export async function usuarioDePrueba(bd: BD, rol: Rol, activo = true): Promise<UsuarioSesion> {
  const authUserId = randomUUID();
  await bd.insert(user).values({ id: authUserId, name: `Prueba ${rol}`, email: `${authUserId}@prueba.local`, emailVerified: true });
  const [fila] = await bd.insert(usuarios).values({ authUserId, nombre: `Prueba ${rol}`, rol, activo }).returning();
  return { id: fila.id, nombre: fila.nombre, rol: fila.rol, activo: fila.activo };
}

/** Hace fallar toda inserción en la bitácora, para probar que la escritura completa se revierte. */
export async function hacerFallarBitacora(bd: BD): Promise<void> {
  await bd.execute(
    sql.raw(`CREATE FUNCTION falla_bitacora() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'bitácora no disponible'; END $$`),
  );
  await bd.execute(sql.raw("CREATE TRIGGER falla_bitacora BEFORE INSERT ON bitacora FOR EACH ROW EXECUTE FUNCTION falla_bitacora()"));
}
