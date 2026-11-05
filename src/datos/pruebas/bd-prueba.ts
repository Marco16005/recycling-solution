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

/**
 * Base migrada una sola vez por archivo de pruebas y guardada como plantilla: cada prueba carga una copia en lugar de
 * crear Postgres y migrar desde cero. Crear muchas bases a la vez colgaba a PGlite con la máquina cargada (Plan de
 * seguridad, 2026-11-05: dos archivos se pasaron de 30 s en crearBdPrueba).
 */
let plantilla: Promise<File | Blob> | null = null;

async function crearPlantilla(): Promise<File | Blob> {
  const pg = new PGlite();
  try {
    await migrate(drizzle(pg, { schema: esquema }), { migrationsFolder: "drizzle" });
    return await pg.dumpDataDir("none");
  } finally {
    await pg.close();
  }
}

/** Postgres en memoria con todas las migraciones aplicadas. Una base nueva por llamada. */
export async function crearBdPrueba(): Promise<BD> {
  plantilla ??= crearPlantilla().catch((error: unknown) => {
    plantilla = null;
    throw error;
  });
  const pg = new PGlite({ loadDataDir: await plantilla });
  abiertas.push(pg);
  await pg.waitReady;
  return drizzle(pg, { schema: esquema });
}
