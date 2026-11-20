import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { feedbackFileSchema } from "@/lib/contract";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  buildFeedbackFile,
  createFeedback,
  FeedbackError,
  type FeedbackFileWriter,
  MAX_FEEDBACK_ENTRIES,
  publishFeedback,
  withdrawFeedback,
} from "@/lib/feedback";
import { ingestRunFile } from "@/lib/ingest";
import { createTestDb } from "../helpers/test-db";

const { agents, runs, items, feedback, syncRuns } = schema;

const NOW = new Date("2026-11-18T20:00:00Z");
let db: Db;
let close: () => Promise<void>;
let itemId: string;
let otherAgentItemId: string;

class MemoryWriter implements FeedbackFileWriter {
  writes: string[] = [];
  fail = false;
  write(content: string): Promise<void> {
    if (this.fail) return Promise.reject(new Error("Drive unavailable"));
    this.writes.push(content);
    return Promise.resolve();
  }
  get last(): unknown {
    return JSON.parse(this.writes.at(-1)!) as unknown;
  }
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(agents).values([
    { slug: "test-agent", name: "Test", schedule: "0 7 * * *" },
    { slug: "other-agent", name: "Other", schedule: "0 8 * * *" },
  ]);
  const [run] = await db
    .insert(runs)
    .values({
      agentSlug: "test-agent",
      runId: "r1",
      driveFileId: "f1",
      contractVersion: "1.0",
      startedAt: NOW,
      finishedAt: NOW,
      status: "ok",
      summary: "",
      verification: { iterations: 1, result: "ok" },
      raw: {},
    })
    .returning();
  const [otherRun] = await db
    .insert(runs)
    .values({ ...run!, id: undefined, agentSlug: "other-agent", runId: "r2", driveFileId: "f2" })
    .returning();
  const base = { kind: "info", severity: "low" as const, title: "t" };
  const [item] = await db
    .insert(items)
    .values({
      ...base,
      agentSlug: "test-agent",
      fingerprint: "sender:news@example.com",
      firstSeenRunId: run!.id,
      lastSeenRunId: run!.id,
    })
    .returning();
  const [otherItem] = await db
    .insert(items)
    .values({
      ...base,
      agentSlug: "other-agent",
      fingerprint: "cve:CVE-2026-0001:pkg",
      firstSeenRunId: otherRun!.id,
      lastSeenRunId: otherRun!.id,
    })
    .returning();
  itemId = item!.id;
  otherAgentItemId = otherItem!.id;
});

afterEach(async () => {
  await close();
});

async function expectFeedbackError(promise: Promise<unknown>, code: string, message?: RegExp) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(FeedbackError);
  expect((error as FeedbackError).code).toBe(code);
  if (message) expect((error as Error).message).toMatch(message);
}

describe("createFeedback", () => {
  it("creates pending feedback with a contract-valid ID and the item's fingerprint as target", async () => {
    const fb = await createFeedback(
      db,
      { agentSlug: "test-agent", itemId, type: "keep_sender", note: "I read these." },
      NOW,
    );
    expect(fb.id).toMatch(/^fb_[0-9A-Z]{26}$/);
    expect(fb).toMatchObject({
      status: "pending",
      target: { fingerprint: "sender:news@example.com" },
      note: "I read these.",
      createdAt: NOW,
    });
  });

  it("creates an agent-wide rule without an item", async () => {
    const fb = await createFeedback(db, {
      agentSlug: "test-agent",
      type: "rule",
      note: "Never touch mail with an invoice attached.",
    });
    expect(fb).toMatchObject({ itemId: null, target: null });
  });

  it("validates the combination of type, item and note", async () => {
    await expectFeedbackError(
      createFeedback(db, { agentSlug: "test-agent", type: "rule" }),
      "invalid_input",
      /note/,
    );
    await expectFeedbackError(
      createFeedback(db, { agentSlug: "test-agent", type: "rule", itemId, note: "x" }),
      "invalid_input",
      /itemId/,
    );
    await expectFeedbackError(
      createFeedback(db, { agentSlug: "test-agent", type: "dismiss" }),
      "invalid_input",
      /item/,
    );
    await expectFeedbackError(
      createFeedback(db, { agentSlug: "test-agent", type: "incorrect", itemId }),
      "invalid_input",
      /note/,
    );
    await expectFeedbackError(
      createFeedback(db, { agentSlug: "test-agent", type: "delete_mail" as never, itemId }),
      "invalid_input",
    );
  });

  it("refuses an item of another agent", async () => {
    await expectFeedbackError(
      createFeedback(db, { agentSlug: "test-agent", type: "dismiss", itemId: otherAgentItemId }),
      "invalid_input",
      /another agent/,
    );
  });

  it("reports unknown agents and items", async () => {
    await expectFeedbackError(
      createFeedback(db, { agentSlug: "nobody", type: "rule", note: "x" }),
      "not_found",
    );
    await expectFeedbackError(
      createFeedback(db, {
        agentSlug: "test-agent",
        type: "dismiss",
        itemId: "00000000-0000-4000-8000-000000000000",
      }),
      "not_found",
    );
  });
});

describe("publishFeedback", () => {
  it("writes all open feedback as a contract-valid file and marks pending as published", async () => {
    const a = await createFeedback(db, { agentSlug: "test-agent", itemId, type: "dismiss" }, NOW);
    const b = await createFeedback(
      db,
      { agentSlug: "other-agent", type: "rule", note: "Ignore dev dependencies." },
      new Date(NOW.getTime() + 1000),
    );
    const writer = new MemoryWriter();
    const publishedAt = new Date("2026-11-18T20:05:00Z");

    const result = await publishFeedback(db, writer, publishedAt);

    expect(result).toEqual({ entries: 2, newlyPublished: 2 });
    const file = feedbackFileSchema.parse(writer.last);
    expect(file.generated_at).toBe(publishedAt.toISOString());
    expect(file.entries).toEqual([
      {
        id: a.id,
        agent: "test-agent",
        type: "dismiss",
        target: { fingerprint: "sender:news@example.com" },
        created_at: NOW.toISOString(),
      },
      {
        id: b.id,
        agent: "other-agent",
        type: "rule",
        note: "Ignore dev dependencies.",
        created_at: new Date(NOW.getTime() + 1000).toISOString(),
      },
    ]);
    const rows = await db.select().from(feedback);
    expect(rows.every((r) => r.status === "published" && +r.publishedAt! === +publishedAt)).toBe(
      true,
    );
  });

  it("keeps standing entries after consumption and drops consumed one-off and withdrawn ones", async () => {
    const keep = await createFeedback(
      db,
      { agentSlug: "test-agent", itemId, type: "dismiss" },
      NOW,
    );
    const consumed = await createFeedback(
      db,
      { agentSlug: "test-agent", itemId, type: "correct" },
      NOW,
    );
    const withdrawn = await createFeedback(
      db,
      { agentSlug: "test-agent", type: "rule", note: "x" },
      NOW,
    );
    const writer = new MemoryWriter();
    await publishFeedback(db, writer, NOW);

    await db
      .update(feedback)
      .set({ status: "consumed" })
      .where(inArray(feedback.id, [keep.id, consumed.id]));
    await withdrawFeedback(db, withdrawn.id);
    const second = await publishFeedback(db, writer, NOW);

    expect(second).toEqual({ entries: 1, newlyPublished: 0 });
    expect((writer.last as { entries: { id: string }[] }).entries.map((e) => e.id)).toEqual([
      keep.id,
    ]);
  });

  it("leaves feedback pending when writing the file fails", async () => {
    await createFeedback(db, { agentSlug: "test-agent", itemId, type: "dismiss" }, NOW);
    const writer = new MemoryWriter();
    writer.fail = true;

    await expect(publishFeedback(db, writer, NOW)).rejects.toThrow("Drive unavailable");

    const [row] = await db.select().from(feedback);
    expect(row).toMatchObject({ status: "pending", publishedAt: null });
  });

  it("writes an empty file when nothing is open", async () => {
    const writer = new MemoryWriter();
    expect(await publishFeedback(db, writer, NOW)).toEqual({ entries: 0, newlyPublished: 0 });
    expect(writer.last).toMatchObject({ contract_version: "1.0", entries: [] });
  });

  it("closes the loop: published, consumed by a run, one-off gone from the next file", async () => {
    const fb = await createFeedback(db, { agentSlug: "test-agent", itemId, type: "correct" }, NOW);
    const writer = new MemoryWriter();
    await publishFeedback(db, writer, NOW);

    const [sync] = await db.insert(syncRuns).values({ trigger: "manual" }).returning();
    const outcome = await ingestRunFile(
      db,
      {
        driveFileId: "next-run",
        fileName: "next-run.json",
        content: JSON.stringify({
          contract_version: "1.0",
          agent: "test-agent",
          run_id: "test-agent-2026-11-19-0700",
          started_at: "2026-11-19T07:00:00+01:00",
          finished_at: "2026-11-19T07:02:00+01:00",
          status: "ok",
          summary: "Applied feedback.",
          items: [],
          verification: { iterations: 1, result: "ok" },
          feedback_consumed: [fb.id],
        }),
      },
      { syncRunId: sync!.id },
    );
    expect(outcome).toMatchObject({ status: "ingested", feedbackConsumed: 1 });

    await publishFeedback(db, writer, NOW);
    expect((writer.last as { entries: unknown[] }).entries).toEqual([]);
  });
});

describe("withdrawFeedback", () => {
  it("withdraws pending and published feedback, idempotently", async () => {
    const fb = await createFeedback(db, { agentSlug: "test-agent", itemId, type: "dismiss" });
    await withdrawFeedback(db, fb.id);
    await withdrawFeedback(db, fb.id);
    const [row] = await db.select().from(feedback);
    expect(row?.status).toBe("withdrawn");
  });

  it("withdraws consumed standing feedback", async () => {
    const fb = await createFeedback(db, { agentSlug: "test-agent", itemId, type: "dismiss" });
    await db.update(feedback).set({ status: "consumed" }).where(eq(feedback.id, fb.id));
    await withdrawFeedback(db, fb.id);
    const [row] = await db.select().from(feedback);
    expect(row?.status).toBe("withdrawn");
  });

  it("refuses consumed one-off feedback and reports unknown IDs", async () => {
    const fb = await createFeedback(db, { agentSlug: "test-agent", itemId, type: "correct" });
    await db.update(feedback).set({ status: "consumed" }).where(eq(feedback.id, fb.id));
    await expectFeedbackError(withdrawFeedback(db, fb.id), "conflict", /consumed/);
    await expectFeedbackError(withdrawFeedback(db, "fb_unknown"), "not_found");
  });
});

describe("buildFeedbackFile", () => {
  it("refuses more entries than the contract allows", () => {
    const row = {
      id: "fb_1",
      agentSlug: "test-agent",
      type: "dismiss" as const,
      target: null,
      note: null,
      createdAt: NOW,
    };
    const rows = Array.from({ length: MAX_FEEDBACK_ENTRIES + 1 }, () => row);
    expect(() => buildFeedbackFile(rows, NOW)).toThrow(/exceed the contract limit/);
  });
});
