import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";

const migrationsFolder = join(import.meta.dirname, "..", "..", "drizzle");

/**
 * A fresh in-memory Postgres with all committed migrations applied. Running the real migrations
 * (not a schema push) also proves the migration files are complete.
 */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder });
  return { db, close: () => client.close() };
}
