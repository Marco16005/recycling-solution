import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach } from "vitest";
import type { BD } from "../bd";
import * as esquema from "../esquema";

const abiertas: PGlite[] = [];

// Cada base vive en memoria: se cierra al terminar la prueba para no agotar la memoria del contenedor.
afterEach(async () => {
  await Promise.all(abiertas.splice(0).map((pg) => pg.close()));
});

/** Postgres en memoria con todas las migraciones aplicadas. Una base nueva por llamada. */
export async function crearBdPrueba(): Promise<BD> {
  const pg = new PGlite();
  abiertas.push(pg);
  const bd = drizzle(pg, { schema: esquema });
  await migrate(bd, { migrationsFolder: "drizzle" });
  return bd;
}
