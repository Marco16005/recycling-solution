import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

/** Llave del candado de Postgres que impide que dos migradores corran a la vez. */
const CANDADO_MIGRACION = 727_001;

interface EntradaJournal {
  idx: number;
  when: number;
  tag: string;
}

/**
 * Aplica las migraciones pendientes como rs_migrador, vuelve a aplicar los permisos de rs_app y comprueba
 * que lo aplicado coincide, migración por migración, con los archivos (mismo número y misma huella SHA-256).
 * Lanza un error si algo no coincide.
 */
export async function migrar(url: string, raiz = process.cwd()): Promise<{ aplicadas: number }> {
  const carpeta = path.join(raiz, "drizzle");
  const journal: { entries: EntradaJournal[] } = JSON.parse(readFileSync(path.join(carpeta, "meta/_journal.json"), "utf8"));
  const permisos = readFileSync(path.join(raiz, "infra/db/permisos.sql"), "utf8");

  const cliente = new Client({ connectionString: url });
  await cliente.connect();
  try {
    await cliente.query("SELECT pg_advisory_lock($1)", [CANDADO_MIGRACION]);
    await migrate(drizzle(cliente), { migrationsFolder: carpeta });
    await cliente.query(permisos);

    const { rows } = await cliente.query<{ hash: string; created_at: string }>(
      "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at",
    );
    if (rows.length !== journal.entries.length) {
      throw new Error(`La base tiene ${rows.length} migraciones aplicadas y el repositorio ${journal.entries.length}`);
    }
    journal.entries.forEach((entrada, i) => {
      const contenido = readFileSync(path.join(carpeta, `${entrada.tag}.sql`), "utf8");
      const huella = createHash("sha256").update(contenido).digest("hex");
      if (rows[i].hash !== huella || Number(rows[i].created_at) !== entrada.when) {
        throw new Error(`La migración ${entrada.tag} aplicada en la base no coincide con su archivo`);
      }
    });
    return { aplicadas: rows.length };
  } finally {
    await cliente.query("SELECT pg_advisory_unlock($1)", [CANDADO_MIGRACION]).catch(() => undefined);
    await cliente.end();
  }
}
