import "server-only";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { getConfig } from "@/lib/config";
import type { Db } from "./index";
import * as schema from "./schema";

// The WebSocket-based Pool supports interactive transactions, which ingestion needs
// (one transaction per run file, docs/standards.md section 5).
export function createDb(databaseUrl: string): Db {
  const pool = new Pool({ connectionString: databaseUrl });
  return drizzle({ client: pool, schema });
}

let cached: Db | undefined;

/** The application database, created on first use from the validated configuration. */
export function getDb(): Db {
  cached ??= createDb(getConfig().databaseUrl);
  return cached;
}
