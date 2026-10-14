import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as esquema from "./esquema";

/** Tipo común a la conexión real (node-postgres) y a la de pruebas (PGlite). */
export type BD = PgDatabase<PgQueryResultHKT, typeof esquema>;

/** Manejador dentro de una transacción. */
export type Tx = Parameters<Parameters<BD["transaction"]>[0]>[0];
