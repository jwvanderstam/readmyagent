import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { formatDateTime } from "@/lib/format";
import { listIngestErrors } from "@/lib/ingest";
import { resolveIngestErrorAction } from "./mutations";

export const metadata: Metadata = { title: "Ingest errors · readmyagent" };

export default async function IngestErrorsPage() {
  await requireOwner();
  const { timezone } = getConfig();
  const { open, resolved } = await listIngestErrors(getDb());

  return (
    <>
      <h1 className="py-2 text-xl font-semibold">Files that could not be read</h1>
      <p className="text-sm text-neutral-600">
        Fix the agent prompt or the file in Drive, mark the error resolved, then sync. A file that
        is still invalid shows up here again.
      </p>

      {open.length === 0 ? (
        <p className="py-8 text-center text-neutral-600">Every run file was read.</p>
      ) : (
        <ul className="mt-3 divide-y divide-neutral-200">
          {open.map((e) => (
            <li key={e.id} className="py-3">
              <p className="font-medium break-all">{e.fileName}</p>
              <p className="mt-1 text-sm text-neutral-600">
                {formatDateTime(e.createdAt, timezone)} · Drive file{" "}
                <span className="break-all">{e.driveFileId}</span>
              </p>
              <pre className="mt-2 overflow-x-auto rounded bg-neutral-50 p-2 text-xs whitespace-pre-wrap text-neutral-800">
                {e.message}
              </pre>
              <form action={resolveIngestErrorAction} className="mt-2">
                <input type="hidden" name="errorId" value={e.id} />
                <button
                  type="submit"
                  className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-neutral-900"
                >
                  Mark resolved
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {resolved.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold">Recently resolved</h2>
          <ul className="mt-1 space-y-1 text-sm text-neutral-600">
            {resolved.map((e) => (
              <li key={e.id} className="break-all">
                {e.fileName} · resolved {formatDateTime(e.resolvedAt!, timezone)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
