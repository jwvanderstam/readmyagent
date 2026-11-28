import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  add(name: string, content: unknown, modified = "2026-11-18T06:00:00Z", id = `id-${name}`) {
    this.files.push({
      id,
      name,
      modifiedTime: new Date(modified),
      createdTime: new Date(modified),
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
    await sync("cron");
    await sync("cron");
    expect(drive.listedSince).toEqual([null, new Date("2026-11-17T12:00:00Z")]);
  });

  it("lists the whole folder on a manual sync, so older files are backfilled", async () => {
    await sync("cron");
    await sync("manual");
    expect(drive.listedSince).toEqual([null, null]);
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

describe("runSync with Markdown run files (ADR-0012)", () => {
  const md = (name: string) =>
    readFileSync(join(import.meta.dirname, "..", "fixtures", "markdown", name), "utf8");

  it("ingests Markdown runs, registers their agents and ignores other files", async () => {
    drive.add("mail-triage-run-2026-11-28-0648.md", md("mail-triage-run-2026-11-28-0648.md"));
    drive.add("localchat-wachter-run-2026-11-28.md", md("localchat-wachter-run-2026-11-28.md"));
    drive.add("weekbrief-run-2026-w48.md", md("weekbrief-run-2026-w48.md"), "2026-11-27T11:52:16Z");
    drive.add("mail-triage-state.md", "# state");
    drive.add("mail-triage-log.md", "# legacy");
    drive.add("feedback.json", { contract_version: "1.0", generated_at: NOW, entries: [] });

    const result = await sync();

    expect(result).toMatchObject({ status: "ok", filesSeen: 3, runsIngested: 3, errors: 0 });
    const registered = await db.select().from(agents).orderBy(agents.slug);
    expect(registered.map((a) => [a.slug, a.schedule])).toEqual([
      ["localchat-wachter", "CRON_TZ=Europe/Amsterdam 45 7 * * *"],
      ["mail-triage", "CRON_TZ=Europe/Amsterdam 48 6 * * *"],
      ["test-agent", "0 7 * * *"],
      ["weekbrief", "CRON_TZ=Europe/Amsterdam 50 12 * * 5"],
    ]);
    const [mail] = await db.select().from(runs).where(eq(runs.agentSlug, "mail-triage"));
    expect(mail).toMatchObject({
      runId: "mail-triage-run-2026-11-28-0648",
      source: "markdown",
      parseStatus: "ok",
      contractVersion: "markdown",
      driveFileId: "id-mail-triage-run-2026-11-28-0648.md",
      logFileId: "id-mail-triage-run-2026-11-28-0648.md",
      startedAt: new Date("2026-11-28T05:48:00Z"),
      metrics: { kennis: 0, archief: 0, proposed_delete: 2, doubt: 11, processed: 13 },
      markdown: md("mail-triage-run-2026-11-28-0648.md"),
    });
    expect(await db.select().from(ingestErrors)).toEqual([]);
  });

  it("keeps two logs with the same name, ordered by createdTime, and is idempotent", async () => {
    const name = "localchat-wachter-run-2026-11-27.md";
    drive.add(name, md("localchat-wachter-run-2026-11-28.md"), "2026-11-27T06:51:41Z", "morning");
    drive.add(name, md("localchat-wachter-run-2026-11-28.md"), "2026-11-27T17:01:16Z", "evening");

    await sync();
    const second = await sync();

    expect(second).toMatchObject({ filesSeen: 2, runsIngested: 0 });
    const rows = await db
      .select()
      .from(runs)
      .where(eq(runs.agentSlug, "localchat-wachter"))
      .orderBy(runs.startedAt);
    expect(rows.map((r) => [r.driveFileId, r.runId])).toEqual([
      ["morning", "localchat-wachter-run-2026-11-27"],
      ["evening", "localchat-wachter-run-2026-11-27-2"],
    ]);
  });

  it("stores a run it cannot fully read as partial", async () => {
    drive.add("localchat-wachter-run-2026-11-20.md", md("localchat-wachter-run-2026-11-20.md"));
    drive.add("mail-triage-run-2026-11-21-0648.md", "");
    const result = await sync();
    expect(result).toMatchObject({ status: "ok", runsIngested: 2 });
    const rows = await db.select().from(runs);
    expect(rows.map((r) => r.parseStatus)).toEqual(["partial", "partial"]);
  });

  const mailJson = (logFile: string) => ({
    contract_version: "1.2",
    agent: "mail-triage",
    run_id: "mail-triage-2026-11-28-0648",
    started_at: "2026-11-28T06:48:00+01:00",
    finished_at: "2026-11-28T06:49:08+01:00",
    status: "ok",
    summary: "From JSON.",
    items: [],
    verification: { iterations: 1, result: "ok" },
    feedback_consumed: [],
    log_file: logFile,
    schedule: "CRON_TZ=Europe/Amsterdam 48 6 * * *",
  });

  it("lets JSON win and links the Markdown log when both arrive together", async () => {
    const log = "mail-triage-run-2026-11-28-0648.md";
    drive.add(log, md(log));
    drive.add("mail-triage-run-2026-11-28-0648.json", mailJson(log));

    const result = await sync();

    expect(result).toMatchObject({ status: "ok", filesSeen: 2, runsIngested: 1 });
    const rows = await db.select().from(runs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "json",
      summary: "From JSON.",
      logFileId: `id-${log}`,
    });
  });

  it("replaces a Markdown run when its JSON arrives later, keeping the link", async () => {
    const log = "mail-triage-run-2026-11-28-0648.md";
    drive.add(log, md(log));
    await sync();
    drive.add("mail-triage-run-2026-11-28-0648.json", mailJson(log));
    drive.files = drive.files.filter((f) => f.name !== log); // outside the listing window now

    await sync();

    const rows = await db.select().from(runs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "json", logFileId: `id-${log}` });
  });
});
