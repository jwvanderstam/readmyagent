import { count, desc, eq, max } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import { type AgentHealth, loadHealth } from "@/lib/health";

const { agents, runs, items, itemOccurrences, feedback } = schema;

type Opts = { now: Date; defaultTimezone: string };

/** Every agent, active first, with its health (active agents only) and its latest run time. */
export async function listAgents(db: Db, opts: Opts) {
  const [all, health, lastRuns] = await Promise.all([
    db.select().from(agents).orderBy(desc(agents.active), agents.name),
    loadHealth(db, opts),
    db
      .select({ agentSlug: runs.agentSlug, lastRunAt: max(runs.startedAt) })
      .from(runs)
      .groupBy(runs.agentSlug),
  ]);
  return all.map((agent) => ({
    ...agent,
    health: health.find((h) => h.slug === agent.slug) ?? null,
    lastRunAt: lastRuns.find((r) => r.agentSlug === agent.slug)?.lastRunAt ?? null,
  }));
}

export type AgentRow = Awaited<ReturnType<typeof listAgents>>[number];

/** One agent with its health and its most recent runs, each with the number of items. */
export async function getAgentDetail(db: Db, slug: string, opts: Opts & { runLimit?: number }) {
  const [agent] = await db.select().from(agents).where(eq(agents.slug, slug));
  if (!agent) return null;

  const [recentRuns, health] = await Promise.all([
    db
      .select({
        id: runs.id,
        runId: runs.runId,
        startedAt: runs.startedAt,
        status: runs.status,
        summary: runs.summary,
        itemCount: count(itemOccurrences.itemId),
      })
      .from(runs)
      .leftJoin(itemOccurrences, eq(itemOccurrences.runId, runs.id))
      .where(eq(runs.agentSlug, slug))
      .groupBy(runs.id)
      .orderBy(desc(runs.startedAt))
      .limit(opts.runLimit ?? 30),
    agent.active ? loadHealth(db, opts) : Promise.resolve([] as AgentHealth[]),
  ]);

  return { agent, runs: recentRuns, health: health.find((h) => h.slug === slug) ?? null };
}

export type AgentDetail = NonNullable<Awaited<ReturnType<typeof getAgentDetail>>>;

/** One run with its agent, the items it reported and the feedback it consumed. */
export async function getRunDetail(db: Db, id: string) {
  const [row] = await db
    .select({ run: runs, agentName: agents.name })
    .from(runs)
    .innerJoin(agents, eq(agents.slug, runs.agentSlug))
    .where(eq(runs.id, id));
  if (!row) return null;

  const [runItems, consumed] = await Promise.all([
    db
      .select({
        id: items.id,
        title: items.title,
        severity: items.severity,
        state: items.state,
        kind: items.kind,
      })
      .from(itemOccurrences)
      .innerJoin(items, eq(items.id, itemOccurrences.itemId))
      .where(eq(itemOccurrences.runId, id)),
    db
      .select({
        id: feedback.id,
        type: feedback.type,
        note: feedback.note,
        itemId: feedback.itemId,
      })
      .from(feedback)
      .where(eq(feedback.consumedByRun, id)),
  ]);

  return { ...row.run, agentName: row.agentName, items: runItems, consumed };
}

export type RunDetail = NonNullable<Awaited<ReturnType<typeof getRunDetail>>>;
