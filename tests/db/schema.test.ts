import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import { createTestDb } from "../helpers/test-db";

const { agents, runs, items, feedback, syncRuns } = schema;

let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(agents).values({
    slug: "test-agent",
    name: "Test agent",
    schedule: "CRON_TZ=Europe/Amsterdam 0 7 * * *",
  });
});

afterEach(async () => {
  await close();
});

function newRun(overrides: Partial<typeof runs.$inferInsert> = {}): typeof runs.$inferInsert {
  return {
    agentSlug: "test-agent",
    runId: "test-agent-2026-11-18-0700",
    driveFileId: "drive-file-1",
    contractVersion: "1.0",
    startedAt: new Date("2026-11-18T06:00:00Z"),
    finishedAt: new Date("2026-11-18T06:05:00Z"),
    status: "ok",
    summary: "Nothing to report.",
    verification: { iterations: 1, result: "ok" },
    raw: {},
    ...overrides,
  };
}

// Drizzle wraps driver errors; the Postgres message is on the cause.
async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(Error);
  const err = error as Error & { cause?: Error };
  expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(pattern);
}

describe("database schema", () => {
  it("applies defaults for a new agent", async () => {
    const [agent] = await db.select().from(agents);
    expect(agent).toMatchObject({ graceMinutes: 180, active: true });
    expect(agent?.createdAt).toBeInstanceOf(Date);
  });

  it("rejects a run for an unknown agent", async () => {
    await expectDbError(
      db.insert(runs).values(newRun({ agentSlug: "unknown-agent" })),
      /foreign key/i,
    );
  });

  it("makes the Drive file ID the idempotency key for runs", async () => {
    await db.insert(runs).values(newRun());
    await expectDbError(
      db.insert(runs).values(newRun({ runId: "other-run-id" })),
      /runs_drive_file_id_unique/,
    );
  });

  it("keeps run IDs unique per agent", async () => {
    await db.insert(runs).values(newRun());
    await expectDbError(
      db.insert(runs).values(newRun({ driveFileId: "drive-file-2" })),
      /runs_agent_run_id_unique/,
    );
  });

  it("deduplicates items by agent and fingerprint", async () => {
    const [run] = await db.insert(runs).values(newRun()).returning({ id: runs.id });
    const item = {
      agentSlug: "test-agent",
      fingerprint: "sender:news@example.com",
      kind: "proposal_delete",
      severity: "info" as const,
      title: "Promotion",
      firstSeenRunId: run!.id,
      lastSeenRunId: run!.id,
    };
    const [created] = await db.insert(items).values(item).returning();
    expect(created).toMatchObject({ state: "open", occurrences: 1 });
    await expectDbError(db.insert(items).values(item), /items_agent_fingerprint_unique/);
  });

  it("rejects values outside an enum", async () => {
    await expectDbError(
      db.insert(runs).values(newRun({ status: "done" as never })),
      /invalid input value for enum/i,
    );
  });

  it("stores feedback as pending by default", async () => {
    await db.insert(feedback).values({ id: "fb_01TEST", agentSlug: "test-agent", type: "dismiss" });
    const [row] = await db.select().from(feedback).where(eq(feedback.id, "fb_01TEST"));
    expect(row?.status).toBe("pending");
  });

  it("allows only one running sync at a time", async () => {
    await db.insert(syncRuns).values({ trigger: "manual" });
    await expectDbError(
      db.insert(syncRuns).values({ trigger: "cron" }),
      /sync_runs_single_running_idx/,
    );
    await db.update(syncRuns).set({ status: "ok", finishedAt: new Date() });
    await db.insert(syncRuns).values({ trigger: "cron" });
    expect(await db.$count(syncRuns)).toBe(2);
  });
});
