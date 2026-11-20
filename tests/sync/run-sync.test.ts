import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import type { DriveFile, RunFileSource } from "@/lib/drive";
import { createFeedback, type FeedbackFileWriter } from "@/lib/feedback";
import { runSync, SYNC_LOCK_TTL_MS, syncIfStale } from "@/lib/sync";
import { createTestDb } from "../helpers/test-db";

const { agents, runs, ingestErrors, syncRuns, feedback } = schema;

class FakeDrive implements RunFileSource, FeedbackFileWriter {
  files: (DriveFile & { content: string })[] = [];
  listedSince: (Date | null)[] = [];
  failDownload = new Set<string>();
  failList = false;
  written: string[] = [];

  add(name: string, content: unknown, modified = "2026-11-18T06:00:00Z") {
    this.files.push({
      id: `id-${name}`,
      name,
      modifiedTime: new Date(modified),
      size: null,
      content: typeof content === "string" ? content : JSON.stringify(content),
    });
  }
  listFiles(since: Date | null) {
    this.listedSince.push(since);
    if (this.failList) return Promise.reject(new Error("Drive down"));
    return Promise.resolve(this.files.filter((f) => !since || f.modifiedTime > since));
  }
  download(file: DriveFile) {
    if (this.failDownload.has(file.id)) return Promise.reject(new Error("HTTP 500"));
    return Promise.resolve(this.files.find((f) => f.id === file.id)!.content);
  }
  write(content: string) {
    this.written.push(content);
    return Promise.resolve();
  }
}

function runDoc(day: number, extra: Record<string, unknown> = {}) {
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
    ...extra,
  };
}

let db: Db;
let close: () => Promise<void>;
let drive: FakeDrive;
const NOW = new Date("2026-11-18T12:00:00Z");
const now = () => NOW;
const sync = (trigger: "manual" | "cron" = "manual") =>
  runSync(db, { source: drive, feedbackWriter: drive }, { trigger, now });

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(agents).values({ slug: "test-agent", name: "Test", schedule: "0 7 * * *" });
  drive = new FakeDrive();
});

afterEach(async () => {
  await close();
});

describe("runSync", () => {
  it("ingests new run files, ignores other files and records the sync", async () => {
    drive.add("test-agent-run-2026-11-18-0700.json", runDoc(18, { log_file: "log-18.md" }));
    drive.add("log-18.md", "# log");
    drive.add("feedback.json", { contract_version: "1.0", generated_at: NOW, entries: [] });

    const result = await sync();

    expect(result).toMatchObject({ status: "ok", filesSeen: 1, runsIngested: 1, errors: 0 });
    const [run] = await db.select().from(runs);
    expect(run?.logFileId).toBe("id-log-18.md");
    const [row] = await db.select().from(syncRuns);
    expect(row).toMatchObject({
      status: "ok",
      trigger: "manual",
      filesSeen: 1,
      runsIngested: 1,
      finishedAt: NOW,
    });
  });

  it("skips files that are already ingested", async () => {
    drive.add("a.json", runDoc(18));
    await sync();
    const second = await sync();
    expect(second).toMatchObject({ status: "ok", filesSeen: 1, runsIngested: 0 });
  });

  it("lists from one day before the last successful sync", async () => {
    await sync();
    await sync();
    expect(drive.listedSince).toEqual([null, new Date("2026-11-17T12:00:00Z")]);
  });

  it("continues after an invalid file or a failed download and reports partial", async () => {
    drive.add("bad.json", "{ nope");
    drive.add("unreachable.json", runDoc(17));
    drive.add("good.json", runDoc(18));
    drive.failDownload.add("id-unreachable.json");

    const result = await sync();

    expect(result).toMatchObject({ status: "partial", filesSeen: 3, runsIngested: 1, errors: 2 });
    const errors = await db.select().from(ingestErrors);
    expect(errors.map((e) => e.fileName).sort()).toEqual(["bad.json", "unreachable.json"]);
    expect(errors.find((e) => e.fileName === "unreachable.json")?.message).toMatch(
      /^Download failed/,
    );
  });

  it("resolves a download error once the file is ingested later", async () => {
    drive.add("flaky.json", runDoc(18));
    drive.failDownload.add("id-flaky.json");
    await sync();
    drive.failDownload.clear();
    await sync();

    const [error] = await db.select().from(ingestErrors);
    expect(error?.resolvedAt).toEqual(NOW);
  });

  it("marks the sync failed and releases the lock when Drive cannot be listed", async () => {
    drive.failList = true;
    expect(await sync()).toMatchObject({ status: "failed" });
    drive.failList = false;
    expect(await sync()).toMatchObject({ status: "ok" });
  });

  it("refuses a second sync while one is running", async () => {
    await db.insert(syncRuns).values({ trigger: "cron", startedAt: NOW });
    expect(await sync()).toEqual({ status: "busy" });
  });

  it("takes over a stale lock", async () => {
    const stale = new Date(NOW.getTime() - SYNC_LOCK_TTL_MS - 1);
    const [old] = await db
      .insert(syncRuns)
      .values({ trigger: "cron", startedAt: stale })
      .returning();
    expect(await sync()).toMatchObject({ status: "ok" });
    const [closed] = await db.select().from(syncRuns).where(eq(syncRuns.id, old!.id));
    expect(closed?.status).toBe("failed");
  });

  it("publishes pending feedback and keeps consumed standing feedback in the file", async () => {
    const fb = await createFeedback(db, { agentSlug: "test-agent", type: "rule", note: "x" }, NOW);

    const first = await sync();
    expect(first).toMatchObject({ feedbackPublished: true });
    expect(drive.written.at(-1)).toContain(fb.id);

    drive.add("next.json", runDoc(19, { feedback_consumed: [fb.id] }), "2026-11-19T06:00:00Z");
    const second = await sync();
    expect(second).toMatchObject({ runsIngested: 1, feedbackPublished: true });
    expect(drive.written.at(-1)).toContain(fb.id);
    const [row] = await db.select().from(feedback);
    expect(row?.status).toBe("consumed");
  });

  it("does not write feedback.json when nothing changed", async () => {
    await sync();
    expect(drive.written).toEqual([]);
  });
});

describe("syncIfStale", () => {
  const deps = () => ({ source: drive, feedbackWriter: drive });

  it("syncs when there was no sync before", async () => {
    expect(await syncIfStale(db, deps(), now)).toMatchObject({ status: "ok" });
  });

  it("skips when the last sync finished less than five minutes ago", async () => {
    await sync();
    const soon = () => new Date(NOW.getTime() + 4 * 60_000);
    expect(await syncIfStale(db, deps(), soon)).toEqual({ status: "skipped" });
    const later = () => new Date(NOW.getTime() + 6 * 60_000);
    expect(await syncIfStale(db, deps(), later)).toMatchObject({ status: "ok" });
  });

  it("skips while a sync is running", async () => {
    await db.insert(syncRuns).values({ trigger: "cron", startedAt: NOW });
    const later = () => new Date(NOW.getTime() + 6 * 60_000);
    expect(await syncIfStale(db, deps(), later)).toEqual({ status: "skipped" });
  });
});
