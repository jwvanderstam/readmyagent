import "server-only";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { Db } from "./index";
import * as schema from "./schema";

// The WebSocket-based Pool supports interactive transactions, which ingestion needs
// (one transaction per run file, docs/standards.md section 5).
export function createDb(databaseUrl: string): Db {
  const pool = new Pool({ connectionString: databaseUrl });
  return drizzle({ client: pool, schema });
}
