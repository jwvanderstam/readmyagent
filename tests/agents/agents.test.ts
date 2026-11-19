import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentError, createAgent, scheduleProblem, updateAgent } from "@/lib/agents/manage";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import { createFeedback, publishFeedback } from "@/lib/feedback";
import { ingestRunFile } from "@/lib/ingest";
import { getAgentDetail, getRunDetail, listAgents } from "@/lib/reader/agents";
import { createTestDb } from "../helpers/test-db";

const { agents, runs, items, syncRuns } = schema;

const TZ = "Europe/Amsterdam";
const NOW = new Date("2026-11-18T12:00:00Z");
const opts = { defaultTimezone: TZ, now: NOW };
let db: Db;
let close: () => Promise<void>;

const valid = {
  slug: "mail-triage",
  name: "Mail triage",
  schedule: "CRON_TZ=Europe/Amsterdam 0 7 * * *",
  graceMinutes: "180",
  active: true,
};

async function errorOf(p: Promise<unknown>): Promise<AgentError> {
  const e = await p.catch((err: unknown) => err);
  expect(e).toBeInstanceOf(AgentError);
  return e as AgentError;
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
});

afterEach(async () => {
  await close();
});

describe("createAgent", () => {
  it("registers an agent with form values", async () => {
    const agent = await createAgent(db, valid, opts);
    expect(agent).toMatchObject({
      slug: "mail-triage",
      name: "Mail triage",
      graceMinutes: 180,
      active: true,
      createdAt: NOW,
    });
  });

  it("reports every invalid field", async () => {
    const e = await errorOf(
      createAgent(db, { ...valid, slug: "Mail_Triage", name: " ", graceMinutes: "5" }, opts),
    );
    expect(e.code).toBe("invalid_input");
    expect(Object.keys(e.fields).sort()).toEqual(["graceMinutes", "name", "slug"]);
    expect(e.fields.slug).toMatch(/lowercase letters/);
  });

  it("refuses a slug that exists", async () => {
    await createAgent(db, valid, opts);
    const e = await errorOf(createAgent(db, valid, opts));
    expect(e).toMatchObject({ code: "conflict", fields: { slug: "This slug is taken." } });
  });

  it("refuses a schedule health cannot use", async () => {
    for (const schedule of ["every morning", "CRON_TZ=Mars/Base 0 7 * * *", "*/5 * * * *"]) {
      const e = await errorOf(createAgent(db, { ...valid, schedule }, opts));
      expect(e.fields.schedule).toBeTruthy();
    }
    expect(await db.$count(agents)).toBe(0);
  });
});

describe("scheduleProblem", () => {
  it("accepts daily, weekly and hourly schedules", () => {
    expect(scheduleProblem("CRON_TZ=Europe/Amsterdam 48 6 * * *", TZ, NOW)).toBeNull();
    expect(scheduleProblem("0 13 * * 1", TZ, NOW)).toBeNull();
    expect(scheduleProblem("0 * * * *", TZ, NOW)).toBeNull();
  });
});

describe("updateAgent", () => {
  it("changes everything but the slug", async () => {
    await createAgent(db, valid, opts);
    const updated = await updateAgent(
      db,
      "mail-triage",
      { ...valid, slug: "ignored", name: "Mail", graceMinutes: 60, active: false },
      opts,
    );
    expect(updated).toMatchObject({
      slug: "mail-triage",
      name: "Mail",
      graceMinutes: 60,
      active: false,
    });
  });

  it("reports an unknown agent", async () => {
    const e = await errorOf(updateAgent(db, "nope", valid, opts));
    expect(e.code).toBe("not_found");
  });
});

describe("agent views", () => {
  async function ingest(day: number, status: "ok" | "failed", consumed: string[] = []) {
    const dd = String(day).padStart(2, "0");
    const [sync] = await db.insert(syncRuns).values({ trigger: "manual" }).returning();
    await ingestRunFile(
      db,
      {
        driveFileId: `file-${dd}`,
        fileName: `run-${dd}.json`,
        content: JSON.stringify({
          contract_version: "1.0",
          agent: "mail-triage",
          run_id: `mail-triage-2026-11-${dd}-0700`,
          started_at: `2026-11-${dd}T07:00:00+01:00`,
          finished_at: `2026-11-${dd}T07:05:00+01:00`,
          status,
          summary: `Run of day ${day}.`,
          items: [{ fingerprint: `f-${dd}`, kind: "finding", severity: "low", title: `F ${dd}` }],
          verification: { iterations: 1, result: "ok" },
          feedback_consumed: consumed,
        }),
      },
      { syncRunId: sync!.id, now: () => NOW },
    );
    await db
      .update(syncRuns)
      .set({ status: "ok", finishedAt: NOW })
      .where(eq(syncRuns.id, sync!.id));
  }

  beforeEach(async () => {
    await createAgent(db, valid, { ...opts, now: new Date("2026-11-15T12:00:00Z") });
    await createAgent(db, { ...valid, slug: "weekbrief", name: "Weekbrief", active: false }, opts);
  });

  it("lists agents, active first, with health and the latest run", async () => {
    await ingest(16, "ok");
    await ingest(17, "failed");

    const rows = await listAgents(db, { now: NOW, defaultTimezone: TZ });

    expect(rows.map((r) => r.slug)).toEqual(["mail-triage", "weekbrief"]);
    // Slots on the 16th (ok), 17th (failed) and 18th (no run, grace window over at 09:00Z).
    expect(rows[0]!.health).toMatchObject({
      status: "missing",
      counts: { ok: 1, failed: 1, missing: 1 },
    });
    expect(rows[0]!.lastRunAt).toEqual(new Date("2026-11-17T06:00:00Z"));
    expect(rows[1]).toMatchObject({ health: null, lastRunAt: null });
  });

  it("shows an agent's runs newest first with their item counts", async () => {
    await ingest(16, "ok");
    await ingest(17, "failed");

    const detail = await getAgentDetail(db, "mail-triage", { now: NOW, defaultTimezone: TZ });

    expect(detail!.runs.map((r) => [r.runId, r.status, r.itemCount])).toEqual([
      ["mail-triage-2026-11-17-0700", "failed", 1],
      ["mail-triage-2026-11-16-0700", "ok", 1],
    ]);
    expect(detail!.health?.counts.failed).toBe(1);
    expect(await getAgentDetail(db, "nope", { now: NOW, defaultTimezone: TZ })).toBeNull();
  });

  it("shows a run with its items and the feedback it consumed", async () => {
    await ingest(16, "ok");
    const [item] = await db.select().from(items);
    const fb = await createFeedback(
      db,
      { agentSlug: "mail-triage", itemId: item!.id, type: "dismiss" },
      NOW,
    );
    await publishFeedback(db, { write: () => Promise.resolve() }, NOW);
    await ingest(17, "ok", [fb.id]);
    const [run17] = await db
      .select()
      .from(runs)
      .where(eq(runs.runId, "mail-triage-2026-11-17-0700"));

    const run = await getRunDetail(db, run17!.id);

    expect(run).toMatchObject({ agentName: "Mail triage", summary: "Run of day 17." });
    expect(run!.items.map((i) => i.title)).toEqual(["F 17"]);
    expect(run!.consumed).toEqual([{ id: fb.id, type: "dismiss", note: null, itemId: item!.id }]);
    expect(await getRunDetail(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});
