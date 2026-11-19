import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunFile, RunItem } from "@/lib/contract";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import { MAX_AGENTS } from "@/lib/agents/register";
import { ingestRunFile, type RunFileInput } from "@/lib/ingest";
import { createTestDb } from "../helpers/test-db";

const { agents, runs, items, itemOccurrences, feedback, ingestErrors, syncRuns } = schema;

const NOW = new Date("2026-11-18T12:00:00Z");
let db: Db;
let close: () => Promise<void>;
let syncRunId: string;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(agents).values([
    { slug: "test-agent", name: "Test agent", schedule: "CRON_TZ=Europe/Amsterdam 0 7 * * *" },
    { slug: "other-agent", name: "Other agent", schedule: "CRON_TZ=Europe/Amsterdam 0 8 * * *" },
  ]);
  const [sync] = await db.insert(syncRuns).values({ trigger: "manual" }).returning();
  syncRunId = sync!.id;
});

afterEach(async () => {
  await close();
});

function item(fingerprint: string, overrides: Partial<RunItem> = {}): RunItem {
  return {
    fingerprint,
    kind: "info",
    severity: "low",
    title: `Finding ${fingerprint}`,
    ...overrides,
  };
}

function runDoc(day: number, overrides: Partial<RunFile> = {}): RunFile {
  const dd = String(day).padStart(2, "0");
  return {
    contract_version: "1.0",
    agent: "test-agent",
    run_id: `test-agent-2026-11-${dd}-0700`,
    started_at: `2026-11-${dd}T07:00:00+01:00`,
    finished_at: `2026-11-${dd}T07:05:00+01:00`,
    status: "ok",
    summary: "Test run.",
    items: [],
    verification: { iterations: 1, result: "ok" },
    feedback_consumed: [],
    ...overrides,
  };
}

function file(doc: unknown, driveFileId = "file-1"): RunFileInput {
  return {
    driveFileId,
    fileName: `${driveFileId}.json`,
    content: typeof doc === "string" ? doc : JSON.stringify(doc),
  };
}

const ingest = (input: RunFileInput) => ingestRunFile(db, input, { syncRunId, now: () => NOW });

async function itemByFingerprint(fingerprint: string) {
  const [row] = await db.select().from(items).where(eq(items.fingerprint, fingerprint));
  return row!;
}

describe("ingestRunFile", () => {
  it("stores a valid run with its items", async () => {
    const outcome = await ingest(file(runDoc(18, { items: [item("a"), item("b")] })));

    expect(outcome).toMatchObject({ status: "ingested", items: 2, feedbackConsumed: 0 });
    const [run] = await db.select().from(runs);
    expect(run).toMatchObject({
      agentSlug: "test-agent",
      runId: "test-agent-2026-11-18-0700",
      driveFileId: "file-1",
      status: "ok",
      startedAt: new Date("2026-11-18T06:00:00Z"),
      ingestedAt: NOW,
    });
    expect(await db.$count(items)).toBe(2);
    expect(await db.$count(itemOccurrences)).toBe(2);
  });

  it("is idempotent for the same Drive file", async () => {
    await ingest(file(runDoc(18, { items: [item("a")] })));
    const again = await ingest(file(runDoc(18, { items: [item("a")] })));

    expect(again).toEqual({ status: "duplicate" });
    expect(await db.$count(runs)).toBe(1);
    expect((await itemByFingerprint("a")).occurrences).toBe(1);
  });

  it("records invalid JSON as an ingest error, once", async () => {
    const first = await ingest(file("{ not json"));
    await ingest(file("{ not json"));

    expect(first.status).toBe("invalid");
    const errors = await db.select().from(ingestErrors);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ driveFileId: "file-1", fileName: "file-1.json", syncRunId });
    expect(errors[0]?.message).toMatch(/^Not valid JSON/);
    expect(await db.$count(runs)).toBe(0);
  });

  it("names the violated field in a contract error", async () => {
    const outcome = await ingest(file({ ...runDoc(18), status: "done" }));
    expect(outcome.status).toBe("invalid");
    expect(outcome.status === "invalid" && outcome.message).toMatch(/status/);
  });

  it("rejects an unsupported major contract version explicitly", async () => {
    const outcome = await ingest(file({ ...runDoc(18), contract_version: "2.0" }));
    expect(outcome).toEqual({
      status: "invalid",
      message: "Unsupported contract version 2.0; this reader accepts 1.x.",
    });
  });

  it("rejects runs of an unknown agent", async () => {
    const outcome = await ingest(file(runDoc(18, { agent: "rogue-agent" })));
    expect(outcome.status).toBe("invalid");
    expect(outcome.status === "invalid" && outcome.message).toMatch(/Unknown agent "rogue-agent"/);
    expect(await db.$count(runs)).toBe(0);
  });

  it("registers an unknown agent that declares its schedule", async () => {
    const outcome = await ingest(
      file(
        runDoc(18, {
          agent: "new-agent",
          run_id: "new-agent-2026-11-18-0700",
          agent_name: "New agent",
          schedule: "CRON_TZ=Europe/Amsterdam 0 7 * * *",
        }),
      ),
    );

    expect(outcome.status).toBe("ingested");
    const [agent] = await db.select().from(agents).where(eq(agents.slug, "new-agent"));
    expect(agent).toMatchObject({
      name: "New agent",
      schedule: "CRON_TZ=Europe/Amsterdam 0 7 * * *",
      graceMinutes: 180,
      active: true,
      createdAt: new Date("2026-11-18T06:00:00Z"),
    });
  });

  it("names a registered agent after its slug when it declares no name", async () => {
    await ingest(file(runDoc(18, { agent: "new-agent", schedule: "0 7 * * *" })));
    const [agent] = await db.select().from(agents).where(eq(agents.slug, "new-agent"));
    expect(agent?.name).toBe("new-agent");
  });

  it("does not register an agent with an unusable schedule or over the limit", async () => {
    const bad = await ingest(file(runDoc(18, { agent: "new-agent", schedule: "*/5 * * * *" })));
    expect(bad.status === "invalid" && bad.message).toMatch(/unusable schedule/);

    await db.insert(agents).values(
      Array.from({ length: MAX_AGENTS - 2 }, (_, i) => ({
        slug: `filler-${i}`,
        name: `Filler ${i}`,
        schedule: "0 7 * * *",
      })),
    );
    const full = await ingest(
      file(runDoc(18, { agent: "one-more", schedule: "0 7 * * *" }), "file-2"),
    );
    expect(full.status === "invalid" && full.message).toMatch(/limit of 20 agents/);
    expect(await db.$count(agents)).toBe(MAX_AGENTS);
  });

  it("updates name and schedule from the newest run only", async () => {
    const declare = (day: number, name: string, hour: number) =>
      ingest(
        file(
          runDoc(day, { agent_name: name, schedule: `CRON_TZ=Europe/Amsterdam 0 ${hour} * * *` }),
          `file-${day}`,
        ),
      );
    const agent = async () =>
      (await db.select().from(agents).where(eq(agents.slug, "test-agent")))[0]!;

    await declare(17, "Renamed", 9);
    expect(await agent()).toMatchObject({
      name: "Renamed",
      schedule: "CRON_TZ=Europe/Amsterdam 0 9 * * *",
    });

    // An older file ingested late does not roll the change back.
    await declare(16, "Old name", 6);
    expect(await agent()).toMatchObject({ name: "Renamed" });

    // An unusable schedule is ignored; the declared name still applies.
    await ingest(file(runDoc(18, { agent_name: "Newest", schedule: "*/5 * * * *" }), "file-18"));
    expect(await agent()).toMatchObject({
      name: "Newest",
      schedule: "CRON_TZ=Europe/Amsterdam 0 9 * * *",
    });
  });

  it("rejects a second file that reuses a run ID", async () => {
    await ingest(file(runDoc(18), "file-1"));
    const outcome = await ingest(file(runDoc(18), "file-2"));
    expect(outcome.status).toBe("invalid");
    expect(await db.$count(runs)).toBe(1);
    expect(await db.$count(ingestErrors)).toBe(1);
  });

  it("links a repeated finding to the existing item and keeps the latest content", async () => {
    await ingest(file(runDoc(18, { items: [item("a", { title: "Old title" })] }), "file-1"));
    await ingest(
      file(runDoc(19, { items: [item("a", { title: "New title", severity: "high" })] }), "file-2"),
    );

    expect(await db.$count(items)).toBe(1);
    const a = await itemByFingerprint("a");
    expect(a).toMatchObject({ title: "New title", severity: "high", occurrences: 2 });
    expect(await db.$count(itemOccurrences)).toBe(2);
  });

  it("does not let an older run overwrite newer content", async () => {
    await ingest(file(runDoc(19, { items: [item("a", { title: "Newer" })] }), "file-2"));
    await ingest(file(runDoc(18, { items: [item("a", { title: "Older" })] }), "file-1"));

    const a = await itemByFingerprint("a");
    const [older] = await db.select().from(runs).where(eq(runs.driveFileId, "file-1"));
    const [newer] = await db.select().from(runs).where(eq(runs.driveFileId, "file-2"));
    expect(a).toMatchObject({ title: "Newer", occurrences: 2 });
    expect(a.firstSeenRunId).toBe(older!.id);
    expect(a.lastSeenRunId).toBe(newer!.id);
  });

  it("reopens a done item when it reappears, but keeps dismissed and acknowledged", async () => {
    await ingest(file(runDoc(18, { items: [item("a"), item("b"), item("c")] }), "file-1"));
    await db.update(items).set({ state: "done" }).where(eq(items.fingerprint, "a"));
    await db.update(items).set({ state: "dismissed" }).where(eq(items.fingerprint, "b"));
    await db.update(items).set({ state: "acknowledged" }).where(eq(items.fingerprint, "c"));

    await ingest(file(runDoc(19, { items: [item("a"), item("b"), item("c")] }), "file-2"));

    expect((await itemByFingerprint("a")).state).toBe("open");
    expect((await itemByFingerprint("b")).state).toBe("dismissed");
    expect((await itemByFingerprint("c")).state).toBe("acknowledged");
  });

  it("treats a fingerprint repeated within one run as one item", async () => {
    const outcome = await ingest(
      file(runDoc(18, { items: [item("a", { title: "First" }), item("a", { title: "Last" })] })),
    );
    expect(outcome).toMatchObject({ status: "ingested", items: 1 });
    expect(await itemByFingerprint("a")).toMatchObject({ title: "Last", occurrences: 1 });
  });

  it("keeps the same fingerprint separate per agent", async () => {
    await ingest(file(runDoc(18, { items: [item("a")] }), "file-1"));
    await ingest(
      file(
        runDoc(18, { agent: "other-agent", run_id: "other-agent-1", items: [item("a")] }),
        "file-2",
      ),
    );
    expect(await db.$count(items)).toBe(2);
  });

  it("marks only published feedback of the run's own agent as consumed", async () => {
    await db.insert(feedback).values([
      { id: "fb_published", agentSlug: "test-agent", type: "dismiss", status: "published" },
      { id: "fb_pending", agentSlug: "test-agent", type: "dismiss", status: "pending" },
      { id: "fb_withdrawn", agentSlug: "test-agent", type: "dismiss", status: "withdrawn" },
      { id: "fb_other", agentSlug: "other-agent", type: "dismiss", status: "published" },
    ]);

    const outcome = await ingest(
      file(
        runDoc(18, {
          feedback_consumed: ["fb_published", "fb_pending", "fb_withdrawn", "fb_other", "fb_nope"],
        }),
      ),
    );

    expect(outcome).toMatchObject({ status: "ingested", feedbackConsumed: 1 });
    const rows = await db.select().from(feedback);
    const status = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    expect(status).toEqual({
      fb_published: "consumed",
      fb_pending: "pending",
      fb_withdrawn: "withdrawn",
      fb_other: "published",
    });
    const consumed = rows.find((r) => r.id === "fb_published")!;
    const [run] = await db.select().from(runs);
    expect(consumed.consumedByRun).toBe(run!.id);
    expect(consumed.consumedAt).toEqual(NOW);
  });

  it("keeps the first consuming run when feedback is reported again", async () => {
    await db
      .insert(feedback)
      .values({ id: "fb_1", agentSlug: "test-agent", type: "dismiss", status: "published" });
    await ingest(file(runDoc(18, { feedback_consumed: ["fb_1"] }), "file-1"));
    const second = await ingest(file(runDoc(19, { feedback_consumed: ["fb_1"] }), "file-2"));

    expect(second).toMatchObject({ status: "ingested", feedbackConsumed: 0 });
    const [first] = await db.select().from(runs).where(eq(runs.driveFileId, "file-1"));
    const [row] = await db.select().from(feedback);
    expect(row?.consumedByRun).toBe(first!.id);
  });

  it("ingests the documented example run file", async () => {
    await db.insert(agents).values({ slug: "mail-triage", name: "Mail", schedule: "0 6 * * *" });
    const content = readFileSync(
      join(import.meta.dirname, "..", "..", "schemas", "examples", "agent-run.example.json"),
      "utf8",
    );
    const outcome = await ingest({ driveFileId: "example", fileName: "example.json", content });
    expect(outcome).toMatchObject({ status: "ingested", items: 2 });
  });
});
