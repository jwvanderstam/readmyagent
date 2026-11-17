import { expandSchedule } from "./schedule";

export const HEALTH_WINDOW_DAYS = 14;
/** A run that starts slightly before its slot (clock skew, early fire) still counts for it. */
export const EARLY_TOLERANCE_MINUTES = 15;
/** Feedback still unconsumed after this many due slots of its agent is flagged. */
export const STALE_FEEDBACK_SLOTS = 2;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export type HealthAgent = {
  slug: string;
  schedule: string;
  graceMinutes: number;
  createdAt: Date;
};

export type HealthRun = {
  id: string;
  startedAt: Date;
  status: "ok" | "warning" | "failed";
  verificationResult: string | undefined;
};

export type HealthFeedback = { id: string; publishedAt: Date };

export type SlotStatus = "ok" | "warning" | "failed" | "missing" | "pending";

export type Slot = {
  expectedAt: Date;
  deadline: Date;
  status: SlotStatus;
  runId: string | null;
};

export type AgentHealth = {
  slug: string;
  /** Status of the most recent slot that is due, or `no_data` when none is due yet. */
  status: Exclude<SlotStatus, "pending"> | "no_data" | "invalid_schedule";
  error?: string;
  slots: Slot[];
  counts: Record<SlotStatus, number>;
  /** Runs in the window that match no slot, for example a manual run. */
  unscheduledRunIds: string[];
  /** Published feedback the agent has not consumed across STALE_FEEDBACK_SLOTS due slots. */
  staleFeedbackIds: string[];
};

/** Run status as health sees it: a failed verification counts as failed (architecture 6.3). */
export function runOutcome(run: HealthRun): "ok" | "warning" | "failed" {
  if (run.status === "failed" || run.verificationResult === "issues") return "failed";
  return run.status;
}

const emptyCounts = (): Record<SlotStatus, number> => ({
  ok: 0,
  warning: 0,
  failed: 0,
  missing: 0,
  pending: 0,
});

/**
 * Compare expected slots with ingested runs for one agent (architecture 6.3). Pure: all input,
 * including the current time, is passed in.
 */
export function computeAgentHealth(input: {
  agent: HealthAgent;
  runs: HealthRun[];
  publishedFeedback: HealthFeedback[];
  now: Date;
  defaultTimezone: string;
}): AgentHealth {
  const { agent, now } = input;
  const windowStart = new Date(
    Math.max(now.getTime() - HEALTH_WINDOW_DAYS * DAY, agent.createdAt.getTime()),
  );

  let expected: Date[];
  try {
    expected = expandSchedule(agent.schedule, input.defaultTimezone, windowStart, now);
  } catch (e) {
    return {
      slug: agent.slug,
      status: "invalid_schedule",
      error: (e as Error).message,
      slots: [],
      counts: emptyCounts(),
      unscheduledRunIds: [],
      staleFeedbackIds: [],
    };
  }

  const runs = [...input.runs].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const used = new Set<string>();
  const slots: Slot[] = expected.map((expectedAt) => {
    const deadline = new Date(expectedAt.getTime() + agent.graceMinutes * MINUTE);
    const earliest = expectedAt.getTime() - EARLY_TOLERANCE_MINUTES * MINUTE;
    const run = runs.find(
      (r) =>
        !used.has(r.id) &&
        r.startedAt.getTime() >= earliest &&
        r.startedAt.getTime() <= deadline.getTime(),
    );
    if (run) {
      used.add(run.id);
      return { expectedAt, deadline, status: runOutcome(run), runId: run.id };
    }
    return { expectedAt, deadline, status: deadline > now ? "pending" : "missing", runId: null };
  });

  const counts = emptyCounts();
  for (const slot of slots) counts[slot.status] += 1;

  const due = slots.filter((s) => s.status !== "pending");
  const latest = due.at(-1);

  const staleFeedbackIds = input.publishedFeedback
    .filter((f) => due.filter((s) => s.expectedAt > f.publishedAt).length >= STALE_FEEDBACK_SLOTS)
    .map((f) => f.id);

  return {
    slug: agent.slug,
    status: latest ? (latest.status as AgentHealth["status"]) : "no_data",
    slots,
    counts,
    unscheduledRunIds: runs
      .filter((r) => !used.has(r.id) && r.startedAt >= windowStart)
      .map((r) => r.id),
    staleFeedbackIds,
  };
}
