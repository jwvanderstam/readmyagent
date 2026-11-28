import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { applyDeclaredAgentFields, registerAgentFromRun } from "@/lib/agents/register";
import type { RunFile, RunItem } from "@/lib/contract";
import type { Db, Tx } from "@/lib/db";
import { schema } from "@/lib/db";
import { reconcileConsumedFeedback } from "@/lib/feedback/reconcile";
import { parseRunFile } from "./parse";

const { agents, runs, items, itemOccurrences, ingestErrors } = schema;

export type RunFileInput = {
  driveFileId: string;
  fileName: string;
  content: string;
};

export type IngestContext = {
  syncRunId: string;
  now?: () => Date;
  /** Drive ID of the Markdown log named in `log_file`, if it is known. */
  resolveLogFileId?: (fileName: string) => string | null;
};

export type IngestOutcome =
  | { status: "ingested"; runId: string; items: number; feedbackConsumed: number }
  | { status: "duplicate" }
  | { status: "invalid"; message: string };

/**
 * Ingest one run file (architecture 6.1, steps 3 to 6). Idempotent: the Drive file ID is the key,
 * so ingesting the same file again changes nothing. A file that cannot be ingested produces an
 * `ingest_errors` row and is never dropped silently. All writes for one valid file happen in one
 * transaction.
 */
export async function ingestRunFile(
  db: Db,
  file: RunFileInput,
  ctx: IngestContext,
): Promise<IngestOutcome> {
  const now = ctx.now ?? (() => new Date());

  if (await isAlreadyIngested(db, file.driveFileId)) return { status: "duplicate" };

  const parsed = parseRunFile(file.content);
  if (!parsed.ok) return recordIngestError(db, file, ctx.syncRunId, parsed.message, now());
  const run = parsed.run;

  // T4 in SECURITY.md: only registered agents are ingested. An unknown agent registers itself when
  // its run file declares a usable schedule (ADR-0009).
  const [agent] = await db
    .select({ slug: agents.slug })
    .from(agents)
    .where(eq(agents.slug, run.agent));
  if (!agent) {
    const registered = await registerAgentFromRun(db, run, now());
    if (!registered.ok) {
      return recordIngestError(db, file, ctx.syncRunId, registered.message, now());
    }
  }

  const result = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(runs)
      .values({
        agentSlug: run.agent,
        runId: run.run_id,
        driveFileId: file.driveFileId,
        logFileId: run.log_file ? (ctx.resolveLogFileId?.(run.log_file) ?? null) : null,
        contractVersion: run.contract_version,
        startedAt: new Date(run.started_at),
        finishedAt: new Date(run.finished_at),
        status: run.status,
        summary: run.summary,
        metrics: run.metrics ?? null,
        verification: run.verification,
        raw: run,
        ingestedAt: now(),
      })
      .onConflictDoNothing()
      .returning({ id: runs.id });

    if (!inserted) {
      // Either a concurrent ingest of the same file, or another file reusing this run_id.
      if (await isAlreadyIngested(tx, file.driveFileId)) return { status: "duplicate" } as const;
      return {
        status: "conflict",
        message: `Run ID "${run.run_id}" was already ingested for agent "${run.agent}" from another file.`,
      } as const;
    }

    // JSON wins over a Markdown run ingested earlier from this run's log (ADR-0011). The log stays
    // linked. Markdown runs have no items or feedback, so nothing else refers to them.
    if (run.log_file) {
      const replaced = await tx
        .delete(runs)
        .where(
          and(
            eq(runs.agentSlug, run.agent),
            eq(runs.source, "markdown"),
            sql`${runs.raw}->>'file_name' = ${run.log_file}`,
          ),
        )
        .returning({ driveFileId: runs.driveFileId });
      const logFileId = replaced[0]?.driveFileId;
      if (logFileId) {
        await tx
          .update(runs)
          .set({ logFileId })
          .where(and(eq(runs.id, inserted.id), isNull(runs.logFileId)));
      }
    }

    await applyDeclaredAgentFields(tx, run, now());
    const itemCount = await upsertItems(tx, run, inserted.id, now());
    const feedbackConsumed = await reconcileConsumedFeedback(
      tx,
      { id: inserted.id, agentSlug: run.agent, feedbackConsumed: run.feedback_consumed },
      now(),
    );
    // An earlier failure for this file (for example a failed download) is resolved now.
    await tx
      .update(ingestErrors)
      .set({ resolvedAt: now() })
      .where(and(eq(ingestErrors.driveFileId, file.driveFileId), isNull(ingestErrors.resolvedAt)));
    return {
      status: "ingested",
      runId: inserted.id,
      items: itemCount,
      feedbackConsumed,
    } as const;
  });

  if (result.status === "conflict") {
    return recordIngestError(db, file, ctx.syncRunId, result.message, now());
  }
  return result;
}

async function isAlreadyIngested(db: Db | Tx, driveFileId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(eq(runs.driveFileId, driveFileId));
  return row !== undefined;
}

/** Record that a file could not be ingested. Also used by sync for download failures. */
export async function recordIngestError(
  db: Db,
  file: Pick<RunFileInput, "driveFileId" | "fileName">,
  syncRunId: string,
  message: string,
  now: Date,
): Promise<IngestOutcome> {
  // Invalid files are seen again on every sync until fixed; keep one open error per file.
  const [open] = await db
    .select({ id: ingestErrors.id })
    .from(ingestErrors)
    .where(and(eq(ingestErrors.driveFileId, file.driveFileId), isNull(ingestErrors.resolvedAt)));
  if (!open) {
    await db.insert(ingestErrors).values({
      syncRunId,
      driveFileId: file.driveFileId,
      fileName: file.fileName,
      message,
      createdAt: now,
    });
  }
  return { status: "invalid", message };
}

async function upsertItems(tx: Tx, run: RunFile, runDbId: string, now: Date): Promise<number> {
  // A fingerprint reported twice in one run is one finding; the last occurrence wins.
  const byFingerprint = new Map<string, RunItem>();
  for (const item of run.items) byFingerprint.set(item.fingerprint, item);
  if (byFingerprint.size === 0) return 0;

  const runStartedAt = new Date(run.started_at);
  const existing = await tx
    .select()
    .from(items)
    .where(
      and(eq(items.agentSlug, run.agent), inArray(items.fingerprint, [...byFingerprint.keys()])),
    );
  const runStarts = await startTimes(
    tx,
    existing.flatMap((i) => [i.firstSeenRunId, i.lastSeenRunId]),
  );

  for (const [fingerprint, item] of byFingerprint) {
    const content = {
      kind: item.kind,
      severity: item.severity,
      title: item.title,
      body: item.body ?? null,
      source: item.source ?? null,
      suggestedAction: item.suggested_action ?? null,
    };
    const current = existing.find((i) => i.fingerprint === fingerprint);

    let itemId: string;
    if (!current) {
      const [created] = await tx
        .insert(items)
        .values({
          agentSlug: run.agent,
          fingerprint,
          ...content,
          firstSeenRunId: runDbId,
          lastSeenRunId: runDbId,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: items.id });
      itemId = created!.id;
    } else {
      itemId = current.id;
      // Runs can be ingested out of order. Only the most recent occurrence sets the content.
      const isLatest = runStartedAt >= (runStarts.get(current.lastSeenRunId) ?? new Date(0));
      const isEarliest = runStartedAt < (runStarts.get(current.firstSeenRunId) ?? new Date(0));
      await tx
        .update(items)
        .set({
          occurrences: sql`${items.occurrences} + 1`,
          updatedAt: now,
          ...(isLatest && {
            ...content,
            lastSeenRunId: runDbId,
            // Data model, item state machine: a finding that reappears after `done` reopens.
            // `dismissed` and `acknowledged` are owner decisions and stay.
            ...(current.state === "done" && { state: "open" as const }),
          }),
          ...(isEarliest && { firstSeenRunId: runDbId }),
        })
        .where(eq(items.id, current.id));
    }

    await tx.insert(itemOccurrences).values({ itemId, runId: runDbId }).onConflictDoNothing();
  }
  return byFingerprint.size;
}

async function startTimes(tx: Tx, runIds: string[]): Promise<Map<string, Date>> {
  if (runIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: runs.id, startedAt: runs.startedAt })
    .from(runs)
    .where(inArray(runs.id, [...new Set(runIds)]));
  return new Map(rows.map((r) => [r.id, r.startedAt]));
}
