import { count, desc, eq, inArray, isNull } from "drizzle-orm";
import { SEVERITIES } from "@/lib/contract";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import type { ItemState } from "@/lib/items/state";

const { agents, items, itemOccurrences, runs, feedback, syncRuns, ingestErrors } = schema;

/** Inbox tabs and the item states each shows. */
export const INBOX_VIEWS = {
  open: ["open"],
  acknowledged: ["acknowledged"],
  closed: ["done", "dismissed"],
} as const satisfies Record<string, readonly ItemState[]>;
export type InboxView = keyof typeof INBOX_VIEWS;

export const isInboxView = (v: unknown): v is InboxView =>
  typeof v === "string" && Object.hasOwn(INBOX_VIEWS, v);

const severityRank = (s: string) => SEVERITIES.indexOf(s as (typeof SEVERITIES)[number]);

/** Items for one inbox tab: most severe first, then most recently seen. */
export async function listInbox(db: Db, view: InboxView) {
  const rows = await db
    .select({
      id: items.id,
      title: items.title,
      kind: items.kind,
      severity: items.severity,
      state: items.state,
      occurrences: items.occurrences,
      agentSlug: items.agentSlug,
      agentName: agents.name,
      lastSeenAt: runs.startedAt,
    })
    .from(items)
    .innerJoin(agents, eq(agents.slug, items.agentSlug))
    .innerJoin(runs, eq(runs.id, items.lastSeenRunId))
    .where(inArray(items.state, [...INBOX_VIEWS[view]]))
    .limit(500);

  return rows.sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      b.lastSeenAt.getTime() - a.lastSeenAt.getTime(),
  );
}

export type InboxRow = Awaited<ReturnType<typeof listInbox>>[number];

export async function countInbox(db: Db): Promise<Record<InboxView, number>> {
  const rows = await db.select({ state: items.state, n: count() }).from(items).groupBy(items.state);
  const by = (states: readonly string[]) =>
    rows.filter((r) => states.includes(r.state)).reduce((sum, r) => sum + r.n, 0);
  return {
    open: by(INBOX_VIEWS.open),
    acknowledged: by(INBOX_VIEWS.acknowledged),
    closed: by(INBOX_VIEWS.closed),
  };
}

/** One item with its agent, the runs that reported it (newest first) and its feedback. */
export async function getItemDetail(db: Db, id: string) {
  const [row] = await db
    .select({ item: items, agentName: agents.name })
    .from(items)
    .innerJoin(agents, eq(agents.slug, items.agentSlug))
    .where(eq(items.id, id));
  if (!row) return null;

  const [reportedIn, itemFeedback] = await Promise.all([
    db
      .select({
        runId: runs.id,
        fileRunId: runs.runId,
        startedAt: runs.startedAt,
        status: runs.status,
      })
      .from(itemOccurrences)
      .innerJoin(runs, eq(runs.id, itemOccurrences.runId))
      .where(eq(itemOccurrences.itemId, id))
      .orderBy(desc(runs.startedAt))
      .limit(50),
    db.select().from(feedback).where(eq(feedback.itemId, id)).orderBy(desc(feedback.createdAt)),
  ]);

  return { ...row.item, agentName: row.agentName, reportedIn, feedback: itemFeedback };
}

export type ItemDetail = NonNullable<Awaited<ReturnType<typeof getItemDetail>>>;

/** The latest sync and the number of unresolved ingest errors, for the header. */
export async function getSyncStatus(db: Db) {
  const [[last], [errors]] = await Promise.all([
    db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(1),
    db.select({ n: count() }).from(ingestErrors).where(isNull(ingestErrors.resolvedAt)),
  ]);
  return { last: last ?? null, openErrors: errors?.n ?? 0 };
}

/** Agents known to the instance; the inbox shows a setup hint when there are none. */
export async function countAgents(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(agents).where(eq(agents.active, true));
  return row?.n ?? 0;
}
