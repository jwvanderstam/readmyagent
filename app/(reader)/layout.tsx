import Link from "next/link";
import { after } from "next/server";
import type { ReactNode } from "react";
import { StatusBadge } from "@/components/badges";
import { requireOwner } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { formatRelative } from "@/lib/format";
import { log } from "@/lib/log";
import { getSyncStatus } from "@/lib/reader/queries";
import { syncOnOpen } from "@/lib/sync/server";
import { signOutAction } from "./actions";
import { SyncButton } from "./sync-button";

export default async function ReaderLayout({ children }: { children: ReactNode }) {
  await requireOwner();

  // Sync on open (architecture 6.1): after the response, so the page never waits for Drive.
  // syncIfStale skips it when the last sync is less than five minutes old.
  after(async () => {
    try {
      await syncOnOpen();
    } catch (e) {
      log("error", "sync.on_open_failed", (e as Error).message);
    }
  });

  const { timezone } = getConfig();
  const { last, openErrors } = await getSyncStatus(getDb());
  const now = new Date();

  return (
    <div className="mx-auto max-w-2xl px-4 pb-12">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 py-3">
        <nav aria-label="Main" className="flex items-center gap-4">
          <Link href="/" className="text-lg font-semibold">
            readmyagent
          </Link>
          <Link href="/" className="text-sm underline-offset-4 hover:underline">
            Inbox
          </Link>
        </nav>
        <form action={signOutAction}>
          <button
            type="submit"
            className="text-sm text-neutral-600 underline-offset-4 hover:underline"
          >
            Sign out
          </button>
        </form>
      </header>

      <section
        aria-label="Sync"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm text-neutral-600"
      >
        <SyncButton />
        <span>
          {last
            ? `Last sync ${formatRelative(last.finishedAt ?? last.startedAt, now, timezone)}`
            : "Never synced"}
        </span>
        {last && last.status !== "ok" && <StatusBadge status={last.status} />}
        {openErrors > 0 && (
          <span className="font-medium text-red-800">
            {openErrors} file{openErrors === 1 ? "" : "s"} could not be read
          </span>
        )}
      </section>

      <main>{children}</main>
    </div>
  );
}
