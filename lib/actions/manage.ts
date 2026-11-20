import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Action, Db } from "@/lib/db";
import { schema } from "@/lib/db";

const { actions, items } = schema;

export const ACTION_STATUSES = ["todo", "doing", "done", "dropped"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

/** Action list tabs and the statuses each shows. */
export const ACTION_VIEWS = {
  open: ["todo", "doing"],
  closed: ["done", "dropped"],
} as const satisfies Record<string, readonly ActionStatus[]>;
export type ActionView = keyof typeof ACTION_VIEWS;

export const isActionView = (v: unknown): v is ActionView =>
  typeof v === "string" && Object.hasOwn(ACTION_VIEWS, v);

/** Owner transitions. A closed action can be reopened to undo a mistake. */
const TRANSITIONS: Record<ActionStatus, readonly ActionStatus[]> = {
  todo: ["doing", "done", "dropped"],
  doing: ["todo", "done", "dropped"],
  done: ["todo"],
  dropped: ["todo"],
};

export const allowedActionTransitions = (from: ActionStatus): readonly ActionStatus[] =>
  TRANSITIONS[from];

export const TITLE_MAX = 200;
export const NOTES_MAX = 2000;

export const createActionInput = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Give the action a title.")
    .max(TITLE_MAX, `Keep the title under ${TITLE_MAX} characters.`),
  notes: z.string().trim().max(NOTES_MAX).optional(),
  dueOn: z.iso.date("Enter the due date as a date.").optional(),
  itemId: z.uuid().optional(),
});
export type CreateActionInput = z.input<typeof createActionInput>;

export const setActionStatusInput = z.object({
  actionId: z.uuid(),
  status: z.enum(ACTION_STATUSES),
});

export class ActionError extends Error {
  constructor(
    readonly code: "invalid_input" | "not_found" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "ActionError";
  }
}

export async function createAction(
  db: Db,
  raw: CreateActionInput,
  now: Date = new Date(),
): Promise<Action> {
  const parsed = createActionInput.safeParse(raw);
  if (!parsed.success) throw new ActionError("invalid_input", z.prettifyError(parsed.error));
  const input = parsed.data;

  if (input.itemId) {
    const [item] = await db.select({ id: items.id }).from(items).where(eq(items.id, input.itemId));
    if (!item) throw new ActionError("not_found", "Item not found.");
  }

  const [created] = await db
    .insert(actions)
    .values({
      title: input.title,
      notes: input.notes || null,
      dueOn: input.dueOn ?? null,
      itemId: input.itemId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return created!;
}

export async function setActionStatus(
  db: Db,
  raw: unknown,
  now: Date = new Date(),
): Promise<Action> {
  const parsed = setActionStatusInput.safeParse(raw);
  if (!parsed.success) throw new ActionError("invalid_input", z.prettifyError(parsed.error));
  const { actionId, status } = parsed.data;

  const [current] = await db.select().from(actions).where(eq(actions.id, actionId));
  if (!current) throw new ActionError("not_found", "Action not found.");
  if (!TRANSITIONS[current.status].includes(status)) {
    throw new ActionError("conflict", `An action cannot go from ${current.status} to ${status}.`);
  }

  const [updated] = await db
    .update(actions)
    .set({ status, updatedAt: now, completedAt: status === "done" ? now : null })
    .where(eq(actions.id, actionId))
    .returning();
  return updated!;
}

/**
 * Actions for one tab. Open actions: those with a due date first, earliest due first, then newest.
 * Closed actions: most recently changed first.
 */
export async function listActions(db: Db, view: ActionView) {
  const query = db
    .select({
      id: actions.id,
      title: actions.title,
      notes: actions.notes,
      dueOn: actions.dueOn,
      status: actions.status,
      updatedAt: actions.updatedAt,
      itemId: actions.itemId,
      itemTitle: items.title,
    })
    .from(actions)
    .leftJoin(items, eq(items.id, actions.itemId))
    .where(inArray(actions.status, [...ACTION_VIEWS[view]]))
    .limit(500);
  return view === "open"
    ? query.orderBy(sql`${actions.dueOn} asc nulls last`, desc(actions.createdAt))
    : query.orderBy(desc(actions.updatedAt));
}

export type ActionRow = Awaited<ReturnType<typeof listActions>>[number];

export async function countActions(db: Db): Promise<Record<ActionView, number>> {
  const rows = await db
    .select({ status: actions.status, n: sql<number>`count(*)::int` })
    .from(actions)
    .groupBy(actions.status);
  const by = (statuses: readonly string[]) =>
    rows.filter((r) => statuses.includes(r.status)).reduce((sum, r) => sum + r.n, 0);
  return { open: by(ACTION_VIEWS.open), closed: by(ACTION_VIEWS.closed) };
}

/** Actions linked to one item, oldest first. */
export async function listActionsForItem(db: Db, itemId: string): Promise<Action[]> {
  return db
    .select()
    .from(actions)
    .where(eq(actions.itemId, itemId))
    .orderBy(asc(actions.createdAt));
}
