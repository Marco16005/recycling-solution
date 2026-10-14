import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { BD } from "../bd";
import * as esquema from "../esquema";

/** Postgres en memoria con todas las migraciones aplicadas. Una base nueva por llamada. */
export async function crearBdPrueba(): Promise<BD> {
  const bd = drizzle(new PGlite(), { schema: esquema });
  await migrate(bd, { migrationsFolder: "drizzle" });
  return bd;
}
