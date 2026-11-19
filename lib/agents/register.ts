import { and, count, eq, gt, ne, notExists, or } from "drizzle-orm";
import type { RunFile } from "@/lib/contract";
import type { Db, Tx } from "@/lib/db";
import { schema } from "@/lib/db";
import { scheduleProblem } from "./manage";

const { agents, runs } = schema;

/** Safety net against a flood of forged run files creating agents (SECURITY.md T4). */
export const MAX_AGENTS = 20;

// Only validity is checked here, and a schedule is valid or not in any timezone. Health later
// expands it in the instance timezone.
const VALIDATION_TIMEZONE = "UTC";

type Declared = Pick<RunFile, "agent" | "agent_name" | "schedule" | "started_at">;

const declaredName = (run: Declared) => run.agent_name?.trim() || null;

/**
 * Register an unknown agent from its run file (ADR-0009). Needs a valid `schedule` in the run file
 * and room under MAX_AGENTS. Returns a readable reason when the agent cannot be registered.
 */
export async function registerAgentFromRun(
  db: Db,
  run: Declared,
  now: Date,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!run.schedule) {
    return {
      ok: false,
      message: `Unknown agent "${run.agent}". Add it in the app, or let the agent declare its schedule in its run files (contract 1.1).`,
    };
  }
  const problem = scheduleProblem(run.schedule, VALIDATION_TIMEZONE, now);
  if (problem) {
    return {
      ok: false,
      message: `Unknown agent "${run.agent}" declares an unusable schedule: ${problem}`,
    };
  }
  const [total] = await db.select({ n: count() }).from(agents);
  if ((total?.n ?? 0) >= MAX_AGENTS) {
    return {
      ok: false,
      message: `Unknown agent "${run.agent}" not registered: the limit of ${MAX_AGENTS} agents is reached.`,
    };
  }
  const startedAt = new Date(run.started_at);
  await db
    .insert(agents)
    .values({
      slug: run.agent,
      name: declaredName(run) ?? run.agent,
      schedule: run.schedule.trim(),
      // Health counts slots from here, so the run that registers the agent is the first slot.
      createdAt: startedAt < now ? startedAt : now,
    })
    .onConflictDoNothing();
  return { ok: true };
}

/**
 * Apply the name and schedule a known agent declares, so changes in the scheduled task reach the
 * app without manual edits (ADR-0009). Only the newest run counts, so an older file ingested late
 * cannot roll a change back. An unusable declared schedule is ignored and the stored one kept.
 */
export async function applyDeclaredAgentFields(tx: Tx, run: Declared, now: Date): Promise<void> {
  const name = declaredName(run);
  const schedule = run.schedule?.trim() || null;
  const set: { name?: string; schedule?: string } = {};
  if (name) set.name = name;
  if (schedule && !scheduleProblem(schedule, VALIDATION_TIMEZONE, now)) set.schedule = schedule;
  if (!set.name && !set.schedule) return;

  const newer = tx
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.agentSlug, run.agent), gt(runs.startedAt, new Date(run.started_at))));
  await tx
    .update(agents)
    .set(set)
    .where(
      and(
        eq(agents.slug, run.agent),
        notExists(newer),
        or(
          set.name ? ne(agents.name, set.name) : undefined,
          set.schedule ? ne(agents.schedule, set.schedule) : undefined,
        ),
      ),
    );
}
