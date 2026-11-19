import type { Metadata } from "next";
import Link from "next/link";
import { SeverityBadge } from "@/components/badges";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { formatRelative } from "@/lib/format";
import { countAgents, countInbox, INBOX_VIEWS, isInboxView, listInbox } from "@/lib/reader/queries";
import { requireOwner } from "@/lib/auth";

export const metadata: Metadata = { title: "Inbox · readmyagent" };

const TAB_LABEL = { open: "Open", acknowledged: "Acknowledged", closed: "Closed" } as const;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function InboxPage({ searchParams }: Props) {
  await requireOwner();
  const params = await searchParams;
  const view = isInboxView(params.view) ? params.view : "open";
  const db = getDb();
  const { timezone } = getConfig();
  const [rows, counts, agentCount] = await Promise.all([
    listInbox(db, view),
    countInbox(db),
    countAgents(db),
  ]);
  const now = new Date();

  return (
    <>
      <h1 className="sr-only">Inbox</h1>
      <nav aria-label="Inbox views" className="flex gap-1 border-b border-neutral-200">
        {(Object.keys(INBOX_VIEWS) as (keyof typeof INBOX_VIEWS)[]).map((v) => (
          <Link
            key={v}
            href={v === "open" ? "/" : `/?view=${v}`}
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
          {agentCount === 0
            ? "No agents are registered yet, so there is nothing to read."
            : view === "open"
              ? "Nothing open. All findings are handled."
              : "No items here."}
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200">
          {rows.map((item) => (
            <li key={item.id}>
              <Link
                href={`/items/${item.id}`}
                className="block py-3 focus-visible:outline-2 focus-visible:outline-neutral-900"
              >
                <div className="flex items-start gap-2">
                  <SeverityBadge severity={item.severity} />
                  <span className="font-medium break-words">{item.title}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-2 text-sm text-neutral-600">
                  <span>{item.agentName}</span>
                  <span aria-hidden>·</span>
                  <span>{item.kind.replaceAll("_", " ")}</span>
                  <span aria-hidden>·</span>
                  <span>{formatRelative(item.lastSeenAt, now, timezone)}</span>
                  {item.occurrences > 1 && (
                    <>
                      <span aria-hidden>·</span>
                      <span>seen {item.occurrences}×</span>
                    </>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
