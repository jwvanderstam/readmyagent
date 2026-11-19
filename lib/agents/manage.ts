import { eq } from "drizzle-orm";
import { z } from "zod";
import { agentSlugSchema } from "@/lib/contract";
import type { Agent, Db } from "@/lib/db";
import { schema } from "@/lib/db";
import { expandSchedule, validateSchedule } from "@/lib/health";

const { agents } = schema;

/**
 * At most this many expected runs in a 14-day health window. Health expands every slot, so a
 * schedule such as `* * * * *` (20,160 slots) would make every health view slow.
 */
export const MAX_SLOTS_PER_WINDOW = 14 * 24;

const agentFields = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(100),
  schedule: z.string().trim().min(1, "Enter a schedule.").max(200),
  graceMinutes: z.coerce
    .number({ error: "Enter a number of minutes." })
    .int("Use whole minutes.")
    .min(15, "Use at least 15 minutes.")
    .max(1440, "Use at most 1440 minutes (one day)."),
  active: z.boolean(),
});

const createFields = agentFields.extend({
  slug: agentSlugSchema.refine(Boolean, "Enter a slug."),
});

export type AgentFieldErrors = Partial<Record<"slug" | keyof z.infer<typeof agentFields>, string>>;

export class AgentError extends Error {
  constructor(
    readonly code: "invalid_input" | "conflict" | "not_found",
    message: string,
    readonly fields: AgentFieldErrors = {},
  ) {
    super(message);
    this.name = "AgentError";
  }
}

const SLUG_HINT = "Use lowercase letters, digits and single hyphens, as in the agent's run files.";

function fieldErrors(error: z.ZodError): AgentFieldErrors {
  const out: AgentFieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0] as keyof AgentFieldErrors;
    out[key] ??= key === "slug" && issue.code === "invalid_format" ? SLUG_HINT : issue.message;
  }
  return out;
}

/** A readable problem with the schedule, or null when health can use it. */
export function scheduleProblem(scheduleText: string, defaultTimezone: string, now: Date) {
  try {
    validateSchedule(scheduleText, defaultTimezone);
  } catch {
    return "Not a valid cron expression, for example CRON_TZ=Europe/Amsterdam 0 7 * * *.";
  }
  const tz = /^CRON_TZ=(\S+)\s/.exec(scheduleText.trim())?.[1];
  if (tz) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
    } catch {
      return `Unknown timezone ${tz}.`;
    }
  }
  // Half-open window (now - 14 days, now], so an hourly schedule has exactly 336 slots.
  const from = new Date(now.getTime() - 14 * 24 * 3600_000 + 1);
  if (expandSchedule(scheduleText, defaultTimezone, from, now).length > MAX_SLOTS_PER_WINDOW) {
    return "Runs more than once an hour on average. Health supports at most hourly schedules.";
  }
  return null;
}

function parse<T extends z.ZodType>(fields: T, raw: unknown, tz: string, now: Date): z.infer<T> {
  const parsed = fields.safeParse(raw);
  if (!parsed.success) {
    throw new AgentError(
      "invalid_input",
      "Check the highlighted fields.",
      fieldErrors(parsed.error),
    );
  }
  const data = parsed.data as z.infer<typeof agentFields>;
  const problem = scheduleProblem(data.schedule, tz, now);
  if (problem) {
    throw new AgentError("invalid_input", "Check the highlighted fields.", { schedule: problem });
  }
  return parsed.data;
}

type Options = { defaultTimezone: string; now?: Date };

/** Register an agent (ADR-0007: agents are managed in the app, not in code or config). */
export async function createAgent(db: Db, raw: unknown, opts: Options): Promise<Agent> {
  const now = opts.now ?? new Date();
  const input = parse(createFields, raw, opts.defaultTimezone, now);
  const [created] = await db
    .insert(agents)
    .values({ ...input, createdAt: now })
    .onConflictDoNothing()
    .returning();
  if (!created) {
    throw new AgentError("conflict", "An agent with this slug exists.", {
      slug: "This slug is taken.",
    });
  }
  return created;
}

/**
 * Change an agent. The slug never changes: run files, items and feedback refer to it. Agents are
 * deactivated, never deleted, because their runs and feedback are owner data.
 */
export async function updateAgent(
  db: Db,
  slug: string,
  raw: unknown,
  opts: Options,
): Promise<Agent> {
  const input = parse(agentFields, raw, opts.defaultTimezone, opts.now ?? new Date());
  const [updated] = await db.update(agents).set(input).where(eq(agents.slug, slug)).returning();
  if (!updated) throw new AgentError("not_found", "Agent not found.");
  return updated;
}
