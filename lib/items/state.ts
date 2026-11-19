import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db, Item } from "@/lib/db";
import { schema } from "@/lib/db";

const { items } = schema;

export const ITEM_STATES = ["open", "acknowledged", "done", "dismissed"] as const;
export type ItemState = (typeof ITEM_STATES)[number];

/**
 * Owner transitions (data model, section 3). Reopening from any closed state undoes a mistake; the
 * automatic reopen of a finding that reappears after `done` lives in ingestion.
 */
const TRANSITIONS: Record<ItemState, readonly ItemState[]> = {
  open: ["acknowledged", "dismissed"],
  acknowledged: ["done", "dismissed", "open"],
  done: ["open"],
  dismissed: ["open"],
};

export const allowedTransitions = (from: ItemState): readonly ItemState[] => TRANSITIONS[from];

export const setItemStateInput = z.object({
  itemId: z.uuid(),
  state: z.enum(ITEM_STATES),
});

export class ItemError extends Error {
  constructor(
    readonly code: "invalid_input" | "not_found" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "ItemError";
  }
}

export async function setItemState(db: Db, raw: unknown, now: Date = new Date()): Promise<Item> {
  const parsed = setItemStateInput.safeParse(raw);
  if (!parsed.success) throw new ItemError("invalid_input", z.prettifyError(parsed.error));
  const { itemId, state } = parsed.data;

  const [current] = await db.select().from(items).where(eq(items.id, itemId));
  if (!current) throw new ItemError("not_found", "Item not found.");
  if (!TRANSITIONS[current.state].includes(state)) {
    throw new ItemError("conflict", `An item cannot go from ${current.state} to ${state}.`);
  }

  const [updated] = await db
    .update(items)
    .set({ state, updatedAt: now })
    .where(eq(items.id, itemId))
    .returning();
  return updated!;
}
