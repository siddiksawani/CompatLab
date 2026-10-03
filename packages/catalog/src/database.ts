import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export type CatalogDatabase = NodePgDatabase<typeof schema>;
export type CatalogTransaction = Parameters<Parameters<CatalogDatabase["transaction"]>[0]>[0];
export type CatalogReader = CatalogDatabase | CatalogTransaction;

export function openCatalog(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 10_000,
    application_name: "compatlab-catalog",
  });
  const db = drizzle(pool, { schema });
  pool.on("error", () =>
    process.emitWarning("An idle catalog connection was lost.", {
      code: "CATALOG_CONNECTION_LOST",
    }),
  );
  return { db, pool, close: () => pool.end() };
}

export function catalogTransaction<T>(
  db: CatalogDatabase,
  work: (transaction: CatalogTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`SET LOCAL lock_timeout = '5s'`);
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(17228, 1)`);
    return work(transaction);
  });
}
