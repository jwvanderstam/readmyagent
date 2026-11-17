import { and, eq, inArray } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { FEEDBACK_TYPES } from "@/lib/contract";
import type { Db, Feedback } from "@/lib/db";
import { schema } from "@/lib/db";

const { agents, items, feedback } = schema;

export const createFeedbackInput = z
  .object({
    agentSlug: z.string().min(1),
    itemId: z.uuid().optional(),
    type: z.enum(FEEDBACK_TYPES),
    note: z.string().trim().max(1000).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.type === "rule") {
      if (input.itemId)
        ctx.addIssue({
          code: "custom",
          message: "A rule applies to the agent, not to one item.",
          path: ["itemId"],
        });
      if (!input.note)
        ctx.addIssue({
          code: "custom",
          message: "A rule needs a note that states it.",
          path: ["note"],
        });
    } else if (!input.itemId) {
      ctx.addIssue({
        code: "custom",
        message: "This feedback type needs an item.",
        path: ["itemId"],
      });
    }
    if (input.type === "incorrect" && !input.note) {
      ctx.addIssue({
        code: "custom",
        message: "Explain the right handling in the note.",
        path: ["note"],
      });
    }
  });

export type CreateFeedbackInput = z.input<typeof createFeedbackInput>;

export class FeedbackError extends Error {
  constructor(
    readonly code: "invalid_input" | "not_found" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "FeedbackError";
  }
}

/** `fb_` + ULID: sortable, and matches the contract pattern `^fb_[A-Za-z0-9]+$`. */
export const newFeedbackId = (now: Date) => `fb_${ulid(now.getTime())}`;

/**
 * Create feedback authored by the owner (architecture 6.2, steps 1 and 2). The target is derived
 * from the item, never taken from free input, and the item must belong to the same agent: the only
 * agent-produced value in an entry is the fingerprint, echoed back to the agent that wrote it
 * (SECURITY.md T3).
 */
export async function createFeedback(
  db: Db,
  raw: CreateFeedbackInput,
  now: Date = new Date(),
): Promise<Feedback> {
  const parsed = createFeedbackInput.safeParse(raw);
  if (!parsed.success) {
    throw new FeedbackError("invalid_input", z.prettifyError(parsed.error));
  }
  const input = parsed.data;

  const [agent] = await db
    .select({ slug: agents.slug })
    .from(agents)
    .where(eq(agents.slug, input.agentSlug));
  if (!agent) throw new FeedbackError("not_found", `Unknown agent "${input.agentSlug}".`);

  let target: { fingerprint: string } | null = null;
  if (input.itemId) {
    const [item] = await db
      .select({ agentSlug: items.agentSlug, fingerprint: items.fingerprint })
      .from(items)
      .where(eq(items.id, input.itemId));
    if (!item) throw new FeedbackError("not_found", "Item not found.");
    if (item.agentSlug !== input.agentSlug) {
      throw new FeedbackError("invalid_input", "The item belongs to another agent.");
    }
    target = { fingerprint: item.fingerprint };
  }

  const [created] = await db
    .insert(feedback)
    .values({
      id: newFeedbackId(now),
      agentSlug: input.agentSlug,
      itemId: input.itemId ?? null,
      type: input.type,
      target,
      note: input.note || null,
      createdAt: now,
    })
    .returning();
  return created!;
}

/**
 * Withdraw feedback the agent has not consumed yet. It disappears from feedback.json at the next
 * publish. Consumed feedback is history and cannot be withdrawn.
 */
export async function withdrawFeedback(db: Db, id: string): Promise<void> {
  const updated = await db
    .update(feedback)
    .set({ status: "withdrawn" })
    .where(and(eq(feedback.id, id), inArray(feedback.status, ["pending", "published"])))
    .returning({ id: feedback.id });
  if (updated.length > 0) return;

  const [existing] = await db
    .select({ status: feedback.status })
    .from(feedback)
    .where(eq(feedback.id, id));
  if (!existing) throw new FeedbackError("not_found", "Feedback not found.");
  if (existing.status === "withdrawn") return;
  throw new FeedbackError(
    "conflict",
    `Feedback is already ${existing.status} and cannot be withdrawn.`,
  );
}
