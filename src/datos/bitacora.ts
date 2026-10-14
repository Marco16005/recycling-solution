import type { BD, Tx } from "./bd";
import { bitacora } from "./esquema";

/** campos: nombres de los campos afectados; nunca sus valores. */
export interface Evento {
  usuarioId: string | null;
  entidad: string;
  entidadId: string | null;
  accion: string;
  campos?: string[];
}

/** Agrega un renglón a la bitácora. Se llama dentro de la transacción de la escritura que registra. */
export async function registrarEvento(bd: BD | Tx, evento: Evento): Promise<void> {
  await bd.insert(bitacora).values({
    usuarioId: evento.usuarioId,
    entidad: evento.entidad,
    entidadId: evento.entidadId,
    accion: evento.accion,
    campos: evento.campos ?? [],
  });
}
