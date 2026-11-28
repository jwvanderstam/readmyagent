import { and, eq, isNull, like, or, sql } from "drizzle-orm";
import { registerAgentFromRun } from "@/lib/agents/register";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import { type IngestOutcome, recordIngestError } from "./ingest-run-file";
import { extractMarkdownRun, MARKDOWN_AGENTS, parseRunFileName, runTimes } from "./markdown";

const { agents, runs, ingestErrors } = schema;

export type MarkdownRunFileInput = {
  driveFileId: string;
  fileName: string;
  createdTime: Date | null;
  content: string;
};

export type MarkdownIngestOutcome =
  | IngestOutcome
  /** A JSON run already names this file in `log_file`: JSON wins, the file is only linked. */
  | { status: "linked"; runId: string }
  /** Not a Markdown run file name. Sync filters these out before. */
  | { status: "ignored" };

/**
 * Ingest one Markdown log as a run when its agent wrote no JSON run file (ADR-0011). Idempotent on
 * the Drive file ID. Extraction problems never drop the run: it is stored with
 * `parse_status = 'partial'`. Markdown runs carry no items and consume no feedback.
 */
export async function ingestMarkdownRunFile(
  db: Db,
  file: MarkdownRunFileInput,
  ctx: { syncRunId: string; now?: () => Date },
): Promise<MarkdownIngestOutcome> {
  const now = ctx.now ?? (() => new Date());
  const name = parseRunFileName(file.fileName);
  if (!name) return { status: "ignored" };

  const [seen] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(or(eq(runs.driveFileId, file.driveFileId), eq(runs.logFileId, file.driveFileId)));
  if (seen) return { status: "duplicate" };

  // JSON wins: a JSON run of this agent that names this file as its log only gets the link.
  const [json] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.agentSlug, name.agent),
        eq(runs.source, "json"),
        sql`${runs.raw}->>'log_file' = ${file.fileName}`,
      ),
    );
  if (json) {
    await db
      .update(runs)
      .set({ logFileId: file.driveFileId })
      .where(and(eq(runs.id, json.id), isNull(runs.logFileId)));
    return { status: "linked", runId: json.id };
  }

  const { startedAt, finishedAt } = runTimes(name, file.createdTime);
  const [agent] = await db
    .select({ slug: agents.slug })
    .from(agents)
    .where(eq(agents.slug, name.agent));
  if (!agent) {
    const known = MARKDOWN_AGENTS[name.agent];
    const registered = await registerAgentFromRun(
      db,
      {
        agent: name.agent,
        agent_name: known.name,
        schedule: known.schedule,
        started_at: startedAt.toISOString(),
      },
      now(),
    );
    if (!registered.ok) {
      return recordIngestError(db, file, ctx.syncRunId, registered.message, now());
    }
  }

  const extracted = extractMarkdownRun(name, file.content);

  return db.transaction(async (tx) => {
    // Two logs can share a name (two runs on one day). Both are kept: the later one gets a suffix.
    const taken = new Set(
      (
        await tx
          .select({ runId: runs.runId })
          .from(runs)
          .where(and(eq(runs.agentSlug, name.agent), like(runs.runId, `${name.stem}%`)))
      ).map((r) => r.runId),
    );
    let runId = name.stem;
    for (let n = 2; taken.has(runId); n++) runId = `${name.stem}-${n}`;

    const [inserted] = await tx
      .insert(runs)
      .values({
        agentSlug: name.agent,
        runId,
        driveFileId: file.driveFileId,
        logFileId: file.driveFileId,
        contractVersion: "markdown",
        startedAt,
        finishedAt,
        status: extracted.status,
        summary: extracted.summary,
        metrics: extracted.metrics,
        verification: { iterations: 0, result: "skipped" },
        raw: {
          source: "markdown",
          file_name: file.fileName,
          fields: extracted.fields,
          parse_notes: extracted.notes,
        },
        ingestedAt: now(),
        source: "markdown",
        markdown: file.content,
        parseStatus: extracted.parseStatus,
      })
      .returning({ id: runs.id });

    await tx
      .update(ingestErrors)
      .set({ resolvedAt: now() })
      .where(and(eq(ingestErrors.driveFileId, file.driveFileId), isNull(ingestErrors.resolvedAt)));
    return { status: "ingested", runId: inserted!.id, items: 0, feedbackConsumed: 0 } as const;
  });
}
