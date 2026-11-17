import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export { schema };

/**
 * Database handle used by domain code. Driver-agnostic so tests can run the same code on PGlite
 * while production uses the Neon driver (see client.ts).
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export type Agent = typeof schema.agents.$inferSelect;
export type NewAgent = typeof schema.agents.$inferInsert;
export type Run = typeof schema.runs.$inferSelect;
export type NewRun = typeof schema.runs.$inferInsert;
export type Item = typeof schema.items.$inferSelect;
export type NewItem = typeof schema.items.$inferInsert;
export type Feedback = typeof schema.feedback.$inferSelect;
export type NewFeedback = typeof schema.feedback.$inferInsert;
export type Action = typeof schema.actions.$inferSelect;
export type NewAction = typeof schema.actions.$inferInsert;
export type SyncRun = typeof schema.syncRuns.$inferSelect;
export type IngestError = typeof schema.ingestErrors.$inferSelect;
