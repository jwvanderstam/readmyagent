import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { type FeedbackFile, feedbackFileSchema } from "@/lib/contract";
import type { Db, Feedback } from "@/lib/db";
import { schema } from "@/lib/db";

const { feedback } = schema;

export const FEEDBACK_CONTRACT_VERSION = "1.0";
export const MAX_FEEDBACK_ENTRIES = 500;

// Arbitrary constant that identifies the publish lock among Postgres advisory locks.
const PUBLISH_LOCK_KEY = 728_461_001;

/** Writes the full content of feedback.json. The Drive client implements this. */
export interface FeedbackFileWriter {
  write(content: string): Promise<void>;
}

/** Build feedback.json from feedback rows. Pure. Throws if the result breaks the contract. */
export function buildFeedbackFile(
  rows: Pick<Feedback, "id" | "agentSlug" | "type" | "target" | "note" | "createdAt">[],
  now: Date,
): FeedbackFile {
  if (rows.length > MAX_FEEDBACK_ENTRIES) {
    throw new Error(
      `${rows.length} open feedback entries exceed the contract limit of ${MAX_FEEDBACK_ENTRIES}. Withdraw old feedback or check why agents do not consume it.`,
    );
  }
  const file: FeedbackFile = {
    contract_version: FEEDBACK_CONTRACT_VERSION,
    generated_at: now.toISOString(),
    entries: rows.map((row) => ({
      id: row.id,
      agent: row.agentSlug,
      type: row.type,
      ...(row.target && { target: row.target }),
      ...(row.note && { note: row.note }),
      created_at: row.createdAt.toISOString(),
    })),
  };
  // Never publish a file that agents would reject.
  return feedbackFileSchema.parse(file);
}

export type PublishResult = { entries: number; newlyPublished: number };

/**
 * Regenerate feedback.json with all pending and published feedback and mark pending rows as
 * published (architecture 6.2, step 3).
 *
 * Concurrency: a transaction-scoped advisory lock serializes publishes from this app. The file is
 * written inside the transaction, so a failed write leaves rows pending for the next attempt. If the
 * write succeeds but the commit fails, the next publish writes the same entries again, which is
 * harmless because agents apply entries idempotently (agent contract 3.3).
 */
export async function publishFeedback(
  db: Db,
  writer: FeedbackFileWriter,
  now: Date = new Date(),
): Promise<PublishResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${PUBLISH_LOCK_KEY})`);

    const open = await tx
      .select()
      .from(feedback)
      .where(inArray(feedback.status, ["pending", "published"]))
      .orderBy(asc(feedback.createdAt), asc(feedback.id));

    const file = buildFeedbackFile(open, now);
    await writer.write(`${JSON.stringify(file, null, 2)}\n`);

    const pendingIds = open.filter((f) => f.status === "pending").map((f) => f.id);
    if (pendingIds.length > 0) {
      await tx
        .update(feedback)
        .set({ status: "published", publishedAt: now })
        .where(and(inArray(feedback.id, pendingIds), eq(feedback.status, "pending")));
    }
    return { entries: open.length, newlyPublished: pendingIds.length };
  });
}
