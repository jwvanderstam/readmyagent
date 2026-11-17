import { and, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { schema } from "@/lib/db";

const { feedback } = schema;

/**
 * Mark feedback as consumed by a run (architecture 6.2, step 5). Only published feedback for the
 * run's own agent counts: an ID the agent could not have seen, or one addressed to another agent,
 * is not proof of consumption. Feedback already consumed keeps its first consuming run.
 *
 * Returns the number of feedback rows that became consumed.
 */
export async function reconcileConsumedFeedback(
  db: DbOrTx,
  run: { id: string; agentSlug: string; feedbackConsumed: readonly string[] },
  now: Date,
): Promise<number> {
  if (run.feedbackConsumed.length === 0) return 0;
  const updated = await db
    .update(feedback)
    .set({ status: "consumed", consumedAt: now, consumedByRun: run.id })
    .where(
      and(
        inArray(feedback.id, [...run.feedbackConsumed]),
        eq(feedback.agentSlug, run.agentSlug),
        eq(feedback.status, "published"),
      ),
    )
    .returning({ id: feedback.id });
  return updated.length;
}
