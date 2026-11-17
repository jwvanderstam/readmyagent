import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  computeAgentHealth,
  expandSchedule,
  type HealthAgent,
  type HealthRun,
  loadHealth,
  parseSchedule,
  validateSchedule,
} from "@/lib/health";
import { createTestDb } from "../helpers/test-db";

const TZ = "Europe/Amsterdam";
const at = (iso: string) => new Date(iso);

const agent: HealthAgent = {
  slug: "test-agent",
  // 07:00 Amsterdam = 06:00Z in winter.
  schedule: "CRON_TZ=Europe/Amsterdam 0 7 * * *",
  graceMinutes: 180,
  createdAt: at("2026-11-01T00:00:00Z"),
};

let runSeq = 0;
function run(startedAt: string, overrides: Partial<HealthRun> = {}): HealthRun {
  runSeq += 1;
  return {
    id: `run-${runSeq}`,
    startedAt: at(startedAt),
    status: "ok",
    verificationResult: "ok",
    ...overrides,
  };
}

function health(runs: HealthRun[], now: string, extra: Partial<HealthAgent> = {}, feedback = []) {
  return computeAgentHealth({
    agent: { ...agent, ...extra },
    runs,
    publishedFeedback: feedback,
    now: at(now),
    defaultTimezone: TZ,
  });
}

describe("schedule", () => {
  it("reads the CRON_TZ prefix and falls back to the default timezone", () => {
    expect(parseSchedule("CRON_TZ=UTC 0 7 * * *", TZ)).toEqual({
      expression: "0 7 * * *",
      timezone: "UTC",
    });
    expect(parseSchedule("0 7 * * *", TZ)).toEqual({ expression: "0 7 * * *", timezone: TZ });
  });

  it("follows daylight saving time", () => {
    // DST ends in Europe on 2026-10-25.
    const slots = expandSchedule(
      "0 7 * * *",
      TZ,
      at("2026-10-24T00:00:00Z"),
      at("2026-10-26T23:59:00Z"),
    );
    expect(slots.map((d) => d.toISOString())).toEqual([
      "2026-10-24T05:00:00.000Z",
      "2026-10-25T06:00:00.000Z",
      "2026-10-26T06:00:00.000Z",
    ]);
  });

  it("includes a slot exactly at the start of the interval", () => {
    const slots = expandSchedule(
      "0 6 * * *",
      "UTC",
      at("2026-11-18T06:00:00Z"),
      at("2026-11-18T07:00:00Z"),
    );
    expect(slots).toEqual([at("2026-11-18T06:00:00Z")]);
  });

  it("supports a weekly schedule", () => {
    // Weekbrief: Friday 12:50.
    const slots = expandSchedule(
      "50 12 * * 5",
      TZ,
      at("2026-11-01T00:00:00Z"),
      at("2026-11-30T00:00:00Z"),
    );
    expect(slots).toHaveLength(4);
  });

  it("rejects an invalid expression", () => {
    expect(() => validateSchedule("every morning", TZ)).toThrow();
    expect(() => validateSchedule("CRON_TZ=Europe/Amsterdam 48 6 * * *", TZ)).not.toThrow();
  });
});

describe("computeAgentHealth", () => {
  it("marks a skipped run as missing once the grace window has passed", () => {
    // Slot 2026-11-18 06:00Z, grace 3h: missing from 09:00Z, well within one day.
    const before = health([], "2026-11-18T08:59:00Z", { createdAt: at("2026-11-18T00:00:00Z") });
    const after = health([], "2026-11-18T09:01:00Z", { createdAt: at("2026-11-18T00:00:00Z") });

    expect(before.slots.map((s) => s.status)).toEqual(["pending"]);
    expect(before.status).toBe("no_data");
    expect(after.slots.map((s) => s.status)).toEqual(["missing"]);
    expect(after.status).toBe("missing");
  });

  it("matches runs to slots within the grace window", () => {
    const runs = [run("2026-11-16T06:01:00Z"), run("2026-11-17T08:30:00Z")];
    const h = health(runs, "2026-11-18T12:00:00Z", { createdAt: at("2026-11-16T00:00:00Z") });

    expect(h.slots.map((s) => [s.status, s.runId])).toEqual([
      ["ok", runs[0]!.id],
      ["ok", runs[1]!.id],
      ["missing", null],
    ]);
    expect(h.counts).toMatchObject({ ok: 2, missing: 1 });
    expect(h.status).toBe("missing");
  });

  it("accepts a run that starts shortly before its slot", () => {
    const early = run("2026-11-18T05:50:00Z");
    const h = health([early], "2026-11-18T12:00:00Z", { createdAt: at("2026-11-18T00:00:00Z") });
    expect(h.slots[0]?.runId).toBe(early.id);
  });

  it("does not count a run after the grace window and lists it as unscheduled", () => {
    const late = run("2026-11-18T09:30:00Z");
    const h = health([late], "2026-11-18T12:00:00Z", { createdAt: at("2026-11-18T00:00:00Z") });
    expect(h.slots[0]?.status).toBe("missing");
    expect(h.unscheduledRunIds).toEqual([late.id]);
  });

  it("uses one run for one slot only, earliest slot first", () => {
    // Slots at 05:00Z and 06:00Z (06:00 and 07:00 Amsterdam). The single run fits both windows
    // and is matched to the earliest open slot; the other slot is missing.
    const one = run("2026-11-18T06:00:00Z");
    const h = health([one], "2026-11-18T12:00:00Z", {
      schedule: "0 6,7 * * *",
      createdAt: at("2026-11-18T00:00:00Z"),
    });
    expect(h.slots.map((s) => [s.expectedAt.toISOString(), s.status])).toEqual([
      ["2026-11-18T05:00:00.000Z", "ok"],
      ["2026-11-18T06:00:00.000Z", "missing"],
    ]);
  });

  it("shows failed runs and failed verifications as failed, warnings as warning", () => {
    expect(
      health([run("2026-11-18T06:00:00Z", { status: "failed" })], "2026-11-18T12:00:00Z").status,
    ).toBe("failed");
    expect(
      health(
        [run("2026-11-18T06:00:00Z", { verificationResult: "issues" })],
        "2026-11-18T12:00:00Z",
      ).status,
    ).toBe("failed");
    expect(
      health([run("2026-11-18T06:00:00Z", { status: "warning" })], "2026-11-18T12:00:00Z").status,
    ).toBe("warning");
  });

  it("checks at most 14 days back and nothing before the agent existed", () => {
    const old = health([], "2026-11-30T12:00:00Z", { createdAt: at("2026-01-01T00:00:00Z") });
    expect(old.slots).toHaveLength(14);

    const fresh = health([], "2026-11-30T12:00:00Z", { createdAt: at("2026-11-29T12:00:00Z") });
    expect(fresh.slots).toHaveLength(1);
  });

  it("flags feedback that stays unconsumed across two due slots", () => {
    const feedback = [
      { id: "fb_old", publishedAt: at("2026-11-16T20:00:00Z") },
      { id: "fb_new", publishedAt: at("2026-11-17T20:00:00Z") },
    ];
    const h = computeAgentHealth({
      agent: { ...agent, createdAt: at("2026-11-15T00:00:00Z") },
      runs: [],
      publishedFeedback: feedback,
      now: at("2026-11-18T12:00:00Z"),
      defaultTimezone: TZ,
    });
    expect(h.staleFeedbackIds).toEqual(["fb_old"]);
  });

  it("reports an invalid schedule instead of throwing", () => {
    const h = health([], "2026-11-18T12:00:00Z", { schedule: "not a cron" });
    expect(h.status).toBe("invalid_schedule");
    expect(h.error).toBeTruthy();
  });
});

describe("loadHealth", () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
  });

  afterEach(async () => {
    await close();
  });

  it("computes health for active agents from the database", async () => {
    const { agents, runs, feedback } = schema;
    await db.insert(agents).values([
      {
        slug: "active-agent",
        name: "Active",
        schedule: "CRON_TZ=Europe/Amsterdam 0 7 * * *",
        createdAt: at("2026-11-17T00:00:00Z"),
      },
      {
        slug: "inactive-agent",
        name: "Inactive",
        schedule: "0 7 * * *",
        active: false,
        createdAt: at("2026-11-17T00:00:00Z"),
      },
    ]);
    await db.insert(runs).values({
      agentSlug: "active-agent",
      runId: "r1",
      driveFileId: "f1",
      contractVersion: "1.0",
      startedAt: at("2026-11-17T06:02:00Z"),
      finishedAt: at("2026-11-17T06:05:00Z"),
      status: "ok",
      summary: "ok",
      verification: { iterations: 1, result: "issues" },
      raw: {},
    });
    await db.insert(feedback).values({
      id: "fb_1",
      agentSlug: "active-agent",
      type: "dismiss",
      status: "published",
      publishedAt: at("2026-11-16T00:00:00Z"),
    });

    const result = await loadHealth(db, { now: at("2026-11-18T12:00:00Z"), defaultTimezone: TZ });

    expect(result.map((h) => h.slug)).toEqual(["active-agent"]);
    const [h] = result;
    expect(h?.slots.map((s) => s.status)).toEqual(["failed", "missing"]);
    expect(h?.staleFeedbackIds).toEqual(["fb_1"]);
  });

  it("returns nothing when there are no active agents", async () => {
    expect(await loadHealth(db, { now: new Date(), defaultTimezone: TZ })).toEqual([]);
  });
});
