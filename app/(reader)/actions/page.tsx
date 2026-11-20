import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge } from "@/components/badges";
import { ACTION_VIEWS, countActions, isActionView, listActions } from "@/lib/actions";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { formatDueDate } from "@/lib/format";
import { ActionForm } from "./action-form";
import { ActionStatusButtons } from "./status-buttons";

export const metadata: Metadata = { title: "Actions · readmyagent" };

const TAB_LABEL = { open: "Open", closed: "Closed" } as const;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ActionsPage({ searchParams }: Props) {
  await requireOwner();
  const params = await searchParams;
  const view = isActionView(params.view) ? params.view : "open";
  const db = getDb();
  const [rows, counts] = await Promise.all([listActions(db, view), countActions(db)]);

  return (
    <>
      <h1 className="py-2 text-xl font-semibold">Actions</h1>
      <nav aria-label="Action views" className="flex gap-1 border-b border-neutral-200">
        {(Object.keys(ACTION_VIEWS) as (keyof typeof ACTION_VIEWS)[]).map((v) => (
          <Link
            key={v}
            href={v === "open" ? "/actions" : `/actions?view=${v}`}
            aria-current={v === view ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              v === view ? "border-neutral-900 font-medium" : "border-transparent text-neutral-600"
            }`}
          >
            {TAB_LABEL[v]} <span className="text-neutral-500">{counts[v]}</span>
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-neutral-600">
          {view === "open" ? "No open actions." : "No closed actions."}
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200">
          {rows.map((a) => (
            <li key={a.id} className="py-3">
              <div className="flex items-start gap-2">
                <StatusBadge status={a.status} />
                <span className="font-medium break-words">{a.title}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-2 text-sm text-neutral-600">
                {a.dueOn && <span>due {formatDueDate(a.dueOn)}</span>}
                {a.itemId && (
                  <Link href={`/items/${a.itemId}`} className="break-words underline">
                    {a.itemTitle}
                  </Link>
                )}
              </div>
              {a.notes && (
                <p className="mt-1 text-sm break-words whitespace-pre-line text-neutral-700">
                  {a.notes}
                </p>
              )}
              <div className="mt-2">
                <ActionStatusButtons id={a.id} status={a.status} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {view === "open" && (
        <section className="mt-6 rounded border border-neutral-200 p-3">
          <h2 className="sr-only">New action</h2>
          <ActionForm />
        </section>
      )}
    </>
  );
}
