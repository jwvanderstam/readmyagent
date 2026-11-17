import { and, eq, gte, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  type AgentHealth,
  computeAgentHealth,
  EARLY_TOLERANCE_MINUTES,
  HEALTH_WINDOW_DAYS,
} from "./compute";

const { agents, runs, feedback } = schema;

/** Health for every active agent. Inactive agents are not checked (data model, agents). */
export async function loadHealth(
  db: Db,
  opts: { now: Date; defaultTimezone: string },
): Promise<AgentHealth[]> {
  const activeAgents = await db
    .select()
    .from(agents)
    .where(eq(agents.active, true))
    .orderBy(agents.slug);
  if (activeAgents.length === 0) return [];
  const slugs = activeAgents.map((a) => a.slug);

  const since = new Date(
    opts.now.getTime() - (HEALTH_WINDOW_DAYS * 24 * 60 + EARLY_TOLERANCE_MINUTES) * 60_000,
  );
  const recentRuns = await db
    .select({
      id: runs.id,
      agentSlug: runs.agentSlug,
      startedAt: runs.startedAt,
      status: runs.status,
      verification: runs.verification,
    })
    .from(runs)
    .where(and(inArray(runs.agentSlug, slugs), gte(runs.startedAt, since)));

  const published = await db
    .select({ id: feedback.id, agentSlug: feedback.agentSlug, publishedAt: feedback.publishedAt })
    .from(feedback)
    .where(and(inArray(feedback.agentSlug, slugs), eq(feedback.status, "published")));

  return activeAgents.map((agent) =>
    computeAgentHealth({
      agent,
      runs: recentRuns
        .filter((r) => r.agentSlug === agent.slug)
        .map((r) => ({
          id: r.id,
          startedAt: r.startedAt,
          status: r.status,
          verificationResult: (r.verification as { result?: string } | null)?.result,
        })),
      publishedFeedback: published
        .filter((f) => f.agentSlug === agent.slug && f.publishedAt !== null)
        .map((f) => ({ id: f.id, publishedAt: f.publishedAt! })),
      now: opts.now,
      defaultTimezone: opts.defaultTimezone,
    }),
  );
}
