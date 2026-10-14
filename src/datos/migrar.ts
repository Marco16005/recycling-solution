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

  const esperadas = journal.entries.map((entrada) => ({
    tag: entrada.tag,
    when: entrada.when,
    huella: createHash("sha256").update(readFileSync(path.join(carpeta, `${entrada.tag}.sql`), "utf8")).digest("hex"),
  }));

  const cliente = new Client({ connectionString: url });
  await cliente.connect();
  try {
    await cliente.query("SELECT pg_advisory_lock($1)", [CANDADO_MIGRACION]);

    /** Lo aplicado debe ser el principio exacto de la lista del repositorio; si no, no se toca nada. */
    const comprobar = async (exigirTodas: boolean) => {
      const { rows: tabla } = await cliente.query<{ existe: boolean }>(
        "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS existe",
      );
      const aplicadas = tabla[0].existe
        ? (await cliente.query<{ hash: string; created_at: string }>(
            "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at",
          )).rows
        : [];
      if (aplicadas.length > esperadas.length || (exigirTodas && aplicadas.length !== esperadas.length)) {
        throw new Error(`La base tiene ${aplicadas.length} migraciones aplicadas y el repositorio ${esperadas.length}`);
      }
      aplicadas.forEach((fila, i) => {
        if (fila.hash !== esperadas[i].huella || Number(fila.created_at) !== esperadas[i].when) {
          throw new Error(`La migración ${esperadas[i].tag} aplicada en la base no coincide con su archivo`);
        }
      });
      return aplicadas.length;
    };

    await comprobar(false);
    await migrate(drizzle(cliente), { migrationsFolder: carpeta });
    await cliente.query(permisos);
    return { aplicadas: await comprobar(true) };
  } finally {
    await cliente.query("SELECT pg_advisory_unlock($1)", [CANDADO_MIGRACION]).catch(() => undefined);
    await cliente.end();
  }
}
