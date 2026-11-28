import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { SeverityBadge, StatusBadge } from "@/components/badges";
import { SafeMarkdown } from "@/components/safe-markdown";
import { requireOwner } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { formatDateTime } from "@/lib/format";
import { getRunDetail } from "@/lib/reader/agents";

export const metadata: Metadata = { title: "Run · readmyagent" };

type Props = { params: Promise<{ id: string }> };

export default async function RunPage({ params }: Props) {
  await requireOwner();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const run = await getRunDetail(getDb(), id);
  if (!run) notFound();
  const { timezone } = getConfig();

  const verification = run.verification as {
    result?: unknown;
    iterations?: unknown;
    notes?: unknown;
  };
  const metrics = Object.entries(run.metrics ?? {}).filter(([, v]) => typeof v === "number");
  const fromMarkdown = run.source === "markdown";
  // Set by the Markdown ingest (ADR-0011): extracted text fields and what could not be read.
  const raw = run.raw as { fields?: unknown; parse_notes?: unknown };
  const fields = Object.entries(
    fromMarkdown && typeof raw.fields === "object" && raw.fields !== null ? raw.fields : {},
  ).filter((e): e is [string, string] => typeof e[1] === "string");
  const parseNotes = Array.isArray(raw.parse_notes)
    ? raw.parse_notes.filter((n): n is string => typeof n === "string")
    : [];

  return (
    <article className="py-4">
      <Link
        href={`/agents/${run.agentSlug}`}
        className="text-sm text-neutral-600 underline-offset-4 hover:underline"
      >
        ← {run.agentName}
      </Link>

      <header className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{formatDateTime(run.startedAt, timezone)}</h1>
          <StatusBadge status={run.status} />
        </div>
        <p className="mt-1 text-sm break-all text-neutral-600">
          {run.runId} · finished {formatDateTime(run.finishedAt, timezone)}
          {fromMarkdown && " · read from the Markdown log"}
        </p>
        {run.parseStatus === "partial" && (
          <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm">
            <p>Parts of this log could not be read. The full log is shown below.</p>
            {parseNotes.length > 0 && (
              <ul className="mt-1 ml-5 list-disc">
                {parseNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </header>

      <section className="mt-4">
        <h2 className="sr-only">Summary</h2>
        <SafeMarkdown>{run.summary}</SafeMarkdown>
      </section>

      {fields.length > 0 && (
        <section className="mt-6 text-sm">
          <h2 className="font-semibold">Fields</h2>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
            {fields.map(([name, value]) => (
              <div key={name} className="contents">
                <dt className="text-neutral-600">{name.replaceAll("_", " ")}</dt>
                <dd className="break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {!fromMarkdown && (
        <section className="mt-6 text-sm">
          <h2 className="font-semibold">Verification</h2>
          <p className="mt-1">
            {typeof verification.result === "string" && (
              <StatusBadge status={verification.result} />
            )}
            {typeof verification.iterations === "number" && (
              <span className="ml-2 text-neutral-600">
                {verification.iterations} iteration{verification.iterations === 1 ? "" : "s"}
              </span>
            )}
          </p>
          {typeof verification.notes === "string" && (
            <div className="mt-1">
              <SafeMarkdown>{verification.notes}</SafeMarkdown>
            </div>
          )}
        </section>
      )}

      {metrics.length > 0 && (
        <section className="mt-6 text-sm">
          <h2 className="font-semibold">Metrics</h2>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
            {metrics.map(([name, value]) => (
              <div key={name} className="contents">
                <dt className="text-neutral-600">{name.replaceAll("_", " ")}</dt>
                <dd className="tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold">Items</h2>
        {run.items.length === 0 ? (
          <p className="mt-1 text-sm text-neutral-600">This run reported no items.</p>
        ) : (
          <ul className="mt-1 divide-y divide-neutral-200">
            {run.items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/items/${item.id}`}
                  className="flex items-start gap-2 py-2 focus-visible:outline-2 focus-visible:outline-neutral-900"
                >
                  <SeverityBadge severity={item.severity} />
                  <span className="break-words">{item.title}</span>
                  <span className="ml-auto">
                    <StatusBadge status={item.state} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {run.consumed.length > 0 && (
        <section className="mt-6 text-sm">
          <h2 className="font-semibold">Feedback applied in this run</h2>
          <ul className="mt-1 space-y-1">
            {run.consumed.map((fb) => (
              <li key={fb.id}>
                <span className="font-medium">{fb.type.replaceAll("_", " ")}</span>
                {fb.note && <span className="text-neutral-700"> · {fb.note}</span>}
                {fb.itemId && (
                  <>
                    {" · "}
                    <Link href={`/items/${fb.itemId}`} className="underline">
                      item
                    </Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {run.markdown !== null && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold">Log</h2>
          <div className="mt-2 rounded border border-neutral-200 p-3 text-sm">
            <SafeMarkdown>{run.markdown}</SafeMarkdown>
          </div>
        </section>
      )}

      {run.logFileId && (
        <p className="mt-6 text-sm">
          <a
            href={`https://drive.google.com/file/d/${encodeURIComponent(run.logFileId)}/view`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Open the full log in Google Drive
          </a>
        </p>
      )}
    </article>
  );
}
