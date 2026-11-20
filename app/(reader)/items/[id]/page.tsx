import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { SeverityBadge, StatusBadge } from "@/components/badges";
import { SafeMarkdown } from "@/components/safe-markdown";
import { requireOwner } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { canWithdraw, feedbackOptionsFor } from "@/lib/feedback";
import { getDb } from "@/lib/db/client";
import { formatDateTime, formatDueDate, safeHttpUrl } from "@/lib/format";
import { listActionsForItem } from "@/lib/actions";
import { allowedTransitions, type ItemState } from "@/lib/items/state";
import { getItemDetail } from "@/lib/reader/queries";
import { setItemStateAction } from "../../actions";
import { ItemFeedbackForm, WithdrawButton } from "../../feedback-form";
import { ActionForm } from "../../actions/action-form";
import { ActionStatusButtons } from "../../actions/status-buttons";

export const metadata: Metadata = { title: "Item · readmyagent" };

const ACTION_LABEL: Record<ItemState, string> = {
  acknowledged: "Acknowledge",
  done: "Mark done",
  dismissed: "Dismiss",
  open: "Reopen",
};

type Props = { params: Promise<{ id: string }> };

export default async function ItemPage({ params }: Props) {
  await requireOwner();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const [item, itemActions] = await Promise.all([
    getItemDetail(db, id),
    listActionsForItem(db, id),
  ]);
  if (!item) notFound();
  const { timezone } = getConfig();

  const source = item.source as { type?: unknown; ref?: unknown; url?: unknown } | null;
  const sourceUrl = safeHttpUrl(source?.url);

  return (
    <article className="py-4">
      <Link href="/" className="text-sm text-neutral-600 underline-offset-4 hover:underline">
        ← Inbox
      </Link>

      <header className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={item.severity} />
          <StatusBadge status={item.state} />
          <span className="text-sm text-neutral-600">{item.kind.replaceAll("_", " ")}</span>
        </div>
        <h1 className="mt-2 text-xl font-semibold break-words">{item.title}</h1>
        <p className="mt-1 text-sm text-neutral-600">
          {item.agentName} · seen {item.occurrences}× · first{" "}
          {formatDateTime(item.createdAt, timezone)}
        </p>
      </header>

      <form action={setItemStateAction} className="mt-4 flex flex-wrap gap-2">
        <input type="hidden" name="itemId" value={item.id} />
        {allowedTransitions(item.state).map((to) => (
          <button
            key={to}
            type="submit"
            name="state"
            value={to}
            className="rounded border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-neutral-900"
          >
            {ACTION_LABEL[to]}
          </button>
        ))}
      </form>

      {item.body && (
        <section className="mt-6">
          <h2 className="sr-only">Details</h2>
          <SafeMarkdown>{item.body}</SafeMarkdown>
        </section>
      )}

      {item.suggestedAction && (
        <section className="mt-6 rounded border border-neutral-200 bg-neutral-50 p-3">
          <h2 className="text-sm font-semibold">Suggested action</h2>
          <div className="mt-1">
            <SafeMarkdown>{item.suggestedAction}</SafeMarkdown>
          </div>
        </section>
      )}

      {source && (
        <section className="mt-6 text-sm">
          <h2 className="font-semibold">Source</h2>
          <p className="mt-1 break-all text-neutral-700">
            {typeof source.type === "string" && <span>{source.type.replaceAll("_", " ")}</span>}
            {typeof source.ref === "string" && <span> · {source.ref}</span>}
            {sourceUrl && (
              <>
                {" · "}
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="underline"
                >
                  open
                </a>
              </>
            )}
          </p>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold">Feedback</h2>
        {item.feedback.length === 0 ? (
          <p className="mt-1 text-sm text-neutral-600">No feedback yet.</p>
        ) : (
          <ul className="mt-1 space-y-2">
            {item.feedback.map((fb) => (
              <li key={fb.id} className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{fb.type.replaceAll("_", " ")}</span>
                  <StatusBadge status={fb.status} />
                  <span className="text-neutral-600">{formatDateTime(fb.createdAt, timezone)}</span>
                  {canWithdraw(fb) && <WithdrawButton feedbackId={fb.id} />}
                </div>
                {fb.note && <p className="mt-0.5 break-words text-neutral-700">{fb.note}</p>}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 rounded border border-neutral-200 p-3">
          <ItemFeedbackForm
            agentSlug={item.agentSlug}
            itemId={item.id}
            options={feedbackOptionsFor(item)}
          />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold">Actions</h2>
        {itemActions.length === 0 ? (
          <p className="mt-1 text-sm text-neutral-600">No actions yet.</p>
        ) : (
          <ul className="mt-1 space-y-3">
            {itemActions.map((a) => (
              <li key={a.id} className="text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={a.status} />
                  <span className="font-medium break-words">{a.title}</span>
                  {a.dueOn && (
                    <span className="text-neutral-600">due {formatDueDate(a.dueOn)}</span>
                  )}
                </div>
                <div className="mt-1">
                  <ActionStatusButtons id={a.id} status={a.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 rounded border border-neutral-200 p-3">
          <ActionForm itemId={item.id} />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-semibold">Reported in</h2>
        <ul className="mt-1 space-y-1 text-sm">
          {item.reportedIn.map((run) => (
            <li key={run.runId} className="flex flex-wrap items-center gap-2">
              <span>{formatDateTime(run.startedAt, timezone)}</span>
              <StatusBadge status={run.status} />
              <span className="break-all text-neutral-600">{run.fileRunId}</span>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
