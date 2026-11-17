import { and, count, desc, eq, inArray, lt } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import type { DriveFile, RunFileSource } from "@/lib/drive";
import { type FeedbackFileWriter, publishFeedback } from "@/lib/feedback";
import { ingestRunFile, recordIngestError } from "@/lib/ingest";
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

/**
 * One sync (architecture 6.1): take the lock, list new files, ingest them one by one, publish
 * feedback when it changed, release the lock with counts. A failing file never stops the others.
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
    const since = last ? new Date(last.startedAt.getTime() - SYNC_OVERLAP_MS) : null;

    const listed = await deps.source.listFiles(since);
    const logFiles = new Map(
      listed.filter((f) => f.name.endsWith(".md")).map((f) => [f.name, f.id]),
    );
    const runFiles = listed.filter(isRunFile);
    filesSeen = runFiles.length;

    const known = runFiles.length
      ? new Set(
          (
            await db
              .select({ id: runs.driveFileId })
              .from(runs)
              .where(
                inArray(
                  runs.driveFileId,
                  runFiles.map((f) => f.id),
                ),
              )
          ).map((r) => r.id),
        )
      : new Set<string>();

    for (const file of runFiles.filter((f) => !known.has(f.id))) {
      let content: string;
      try {
        content = await deps.source.download(file);
      } catch (e) {
        errors += 1;
        await recordIngestError(
          db,
          { driveFileId: file.id, fileName: file.name },
          syncRunId,
          `Download failed: ${(e as Error).message}`,
          now(),
        );
        continue;
      }
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
