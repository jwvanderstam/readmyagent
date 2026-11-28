import { and, count, desc, eq, inArray, lt, or } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import type { DriveFile, RunFileSource } from "@/lib/drive";
import { type FeedbackFileWriter, publishFeedback } from "@/lib/feedback";
import {
  ingestMarkdownRunFile,
  ingestRunFile,
  parseRunFileName,
  recordIngestError,
} from "@/lib/ingest";
import { log } from "@/lib/log";

const { runs, feedback, syncRuns } = schema;

export const SYNC_LOCK_TTL_MS = 10 * 60_000;
/** Re-list files from one day before the last sync, so late-arriving files are not missed. */
export const SYNC_OVERLAP_MS = 24 * 60 * 60_000;
export const ON_OPEN_MIN_INTERVAL_MS = 5 * 60_000;
export const FEEDBACK_FILE_NAME = "feedback.json";

export type SyncTrigger = "cron" | "manual" | "on_open";

export type SyncDeps = { source: RunFileSource; feedbackWriter: FeedbackFileWriter };

export type SyncResult =
  | { status: "busy" }
  | {
      status: "ok" | "partial" | "failed";
      syncRunId: string;
      filesSeen: number;
      runsIngested: number;
      errors: number;
      feedbackPublished: boolean;
    };

const isRunFile = (f: DriveFile) => f.name.endsWith(".json") && f.name !== FEEDBACK_FILE_NAME;
/** Markdown logs named like a run of a known agent (ADR-0012). Other `.md` files are ignored. */
const isMarkdownRunFile = (f: DriveFile) => parseRunFileName(f.name) !== null;

/**
 * One sync (architecture 6.1): take the lock, list new files, ingest them one by one, publish
 * feedback when it changed, release the lock with counts. A failing file never stops the others.
 * JSON run files go first, so a Markdown log of the same run is only linked (ADR-0012). A manual
 * sync lists the whole folder, so files outside the incremental window (a backfill) are found.
 */
export async function runSync(
  db: Db,
  deps: SyncDeps,
  opts: { trigger: SyncTrigger; now?: () => Date },
): Promise<SyncResult> {
  const now = opts.now ?? (() => new Date());

  // A sync that crashed without releasing the lock must not block all later syncs.
  await db
    .update(syncRuns)
    .set({ status: "failed", finishedAt: now() })
    .where(
      and(
        eq(syncRuns.status, "running"),
        lt(syncRuns.startedAt, new Date(now().getTime() - SYNC_LOCK_TTL_MS)),
      ),
    );

  // The partial unique index allows one running sync; a second insert is skipped.
  const [lock] = await db
    .insert(syncRuns)
    .values({ trigger: opts.trigger, startedAt: now() })
    .onConflictDoNothing()
    .returning({ id: syncRuns.id });
  if (!lock) return { status: "busy" };
  const syncRunId = lock.id;

  let filesSeen = 0;
  let runsIngested = 0;
  let errors = 0;
  let feedbackConsumed = 0;
  let feedbackPublished = false;
  let failed = false;

  try {
    const [last] = await db
      .select({ startedAt: syncRuns.startedAt })
      .from(syncRuns)
      .where(inArray(syncRuns.status, ["ok", "partial"]))
      .orderBy(desc(syncRuns.startedAt))
      .limit(1);
    const since =
      last && opts.trigger !== "manual"
        ? new Date(last.startedAt.getTime() - SYNC_OVERLAP_MS)
        : null;

    const listed = await deps.source.listFiles(since);
    const logFiles = new Map(
      listed.filter((f) => f.name.endsWith(".md")).map((f) => [f.name, f.id]),
    );
    const runFiles = listed.filter(isRunFile);
    const markdownFiles = listed.filter(isMarkdownRunFile);
    filesSeen = runFiles.length + markdownFiles.length;

    // A Markdown file is known when it is a run itself or the linked log of a JSON run.
    const ids = [...runFiles, ...markdownFiles].map((f) => f.id);
    const known = new Set<string>();
    if (ids.length) {
      const rows = await db
        .select({ id: runs.driveFileId, logFileId: runs.logFileId })
        .from(runs)
        .where(or(inArray(runs.driveFileId, ids), inArray(runs.logFileId, ids)));
      for (const r of rows) {
        known.add(r.id);
        if (r.logFileId) known.add(r.logFileId);
      }
    }

    const download = async (file: DriveFile): Promise<string | null> => {
      try {
        return await deps.source.download(file);
      } catch (e) {
        errors += 1;
        await recordIngestError(
          db,
          { driveFileId: file.id, fileName: file.name },
          syncRunId,
          `Download failed: ${(e as Error).message}`,
          now(),
        );
        return null;
      }
    };

    for (const file of runFiles.filter((f) => !known.has(f.id))) {
      const content = await download(file);
      if (content === null) continue;
      const outcome = await ingestRunFile(
        db,
        { driveFileId: file.id, fileName: file.name, content },
        { syncRunId, now, resolveLogFileId: (name) => logFiles.get(name) ?? null },
      );
      if (outcome.status === "ingested") {
        runsIngested += 1;
        feedbackConsumed += outcome.feedbackConsumed;
      } else if (outcome.status === "invalid") {
        errors += 1;
        log("warn", "ingest.file_invalid", "Run file not ingested", { driveFileId: file.id });
      }
    }

    for (const file of markdownFiles.filter((f) => !known.has(f.id))) {
      const content = await download(file);
      if (content === null) continue;
      const outcome = await ingestMarkdownRunFile(
        db,
        { driveFileId: file.id, fileName: file.name, createdTime: file.createdTime, content },
        { syncRunId, now },
      );
      if (outcome.status === "ingested") {
        runsIngested += 1;
      } else if (outcome.status === "invalid") {
        errors += 1;
        log("warn", "ingest.file_invalid", "Markdown run not ingested", { driveFileId: file.id });
      }
    }

    // Consumed entries must leave feedback.json; pending ones must reach it.
    const [pending] = await db
      .select({ n: count() })
      .from(feedback)
      .where(eq(feedback.status, "pending"));
    if (feedbackConsumed > 0 || (pending?.n ?? 0) > 0) {
      try {
        await publishFeedback(db, deps.feedbackWriter, now());
        feedbackPublished = true;
      } catch (e) {
        errors += 1;
        log("error", "feedback.publish_failed", (e as Error).message, { syncRunId });
      }
    }
  } catch (e) {
    failed = true;
    log("error", "sync.failed", (e as Error).message, { syncRunId, trigger: opts.trigger });
  }

  const status = failed ? "failed" : errors > 0 ? "partial" : "ok";
  await db
    .update(syncRuns)
    .set({ status, finishedAt: now(), filesSeen, runsIngested, errors })
    .where(eq(syncRuns.id, syncRunId));
  log("info", "sync.finished", "Sync finished", {
    syncRunId,
    trigger: opts.trigger,
    status,
    filesSeen,
    runsIngested,
    errors,
  });
  return { status, syncRunId, filesSeen, runsIngested, errors, feedbackPublished };
}

/** Sync on opening the app, unless a sync is running or finished in the last five minutes. */
export async function syncIfStale(
  db: Db,
  deps: SyncDeps,
  now: () => Date = () => new Date(),
): Promise<SyncResult | { status: "skipped" }> {
  const [last] = await db
    .select({
      status: syncRuns.status,
      startedAt: syncRuns.startedAt,
      finishedAt: syncRuns.finishedAt,
    })
    .from(syncRuns)
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  if (last) {
    const lastActivity = (last.finishedAt ?? last.startedAt).getTime();
    const recent = now().getTime() - lastActivity < ON_OPEN_MIN_INTERVAL_MS;
    if (last.status === "running" || recent) return { status: "skipped" };
  }
  return runSync(db, deps, { trigger: "on_open", now });
}
