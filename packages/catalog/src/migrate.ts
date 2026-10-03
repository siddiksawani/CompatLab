import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import type { Pool } from "pg";

export type Migration = { id: string; sql: string };
export async function catalogMigrations(): Promise<Migration[]> {
  const directory = new URL("../migrations/", import.meta.url);
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  return Promise.all(
    files.map(async (id) => ({ id, sql: await readFile(new URL(id, directory), "utf8") })),
  );
}

export async function migrateCatalog(pool: Pool, migrations?: readonly Migration[]): Promise<void> {
  const selected = migrations ?? (await catalogMigrations());
  if (
    new Set(selected.map((item) => item.id)).size !== selected.length ||
    selected.some(
      (item, index) =>
        !/^\d{4}_[a-z0-9_]+\.sql$/.test(item.id) ||
        (index > 0 && item.id <= (selected[index - 1]?.id ?? "")),
    )
  )
    throw new TypeError("Migrations must have unique ordered file names.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL search_path = public, pg_catalog");
    await client.query("SELECT pg_advisory_xact_lock(17228, 2)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const applied = await client.query<{ id: string; checksum: string }>(
      "SELECT id, checksum FROM schema_migrations ORDER BY id",
    );
    for (let index = 0; index < applied.rows.length; index++) {
      const previous = applied.rows[index],
        migration = selected[index];
      if (
        !migration ||
        previous?.id !== migration.id ||
        previous.checksum !== digest(migration.sql)
      )
        throw new Error("Applied migration history differs from this release.");
    }
    for (const migration of selected.slice(applied.rows.length)) {
      await client.query(migration.sql);
      await client.query("INSERT INTO schema_migrations(id, checksum) VALUES ($1, $2)", [
        migration.id,
        digest(migration.sql),
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
function digest(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}
