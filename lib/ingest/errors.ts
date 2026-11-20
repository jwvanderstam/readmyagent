import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";

const { ingestErrors } = schema;

/** Unresolved ingest errors first; the newest resolved ones below them for reference. */
export async function listIngestErrors(db: Db) {
  const [open, resolved] = await Promise.all([
    db
      .select()
      .from(ingestErrors)
      .where(isNull(ingestErrors.resolvedAt))
      .orderBy(desc(ingestErrors.createdAt))
      .limit(200),
    db
      .select()
      .from(ingestErrors)
      .where(isNotNull(ingestErrors.resolvedAt))
      .orderBy(desc(ingestErrors.resolvedAt))
      .limit(20),
  ]);
  return { open, resolved };
}

/**
 * Mark an ingest error resolved by hand, for example after the file was fixed or removed in Drive.
 * A file that is still invalid gets a new error on the next sync, so this never hides a problem
 * for long. Resolving twice is harmless.
 */
export async function resolveIngestError(db: Db, raw: unknown, now: Date = new Date()) {
  const id = z.uuid().safeParse(raw);
  if (!id.success) return { ok: false as const, code: "invalid_input" as const };
  const updated = await db
    .update(ingestErrors)
    .set({ resolvedAt: now })
    .where(and(eq(ingestErrors.id, id.data), isNull(ingestErrors.resolvedAt)))
    .returning({ id: ingestErrors.id });
  if (updated.length > 0) return { ok: true as const };
  const [existing] = await db
    .select({ id: ingestErrors.id })
    .from(ingestErrors)
    .where(eq(ingestErrors.id, id.data));
  return existing ? { ok: true as const } : { ok: false as const, code: "not_found" as const };
}
