"use client";

import { useActionState } from "react";
import { syncAction, type SyncActionState } from "./actions";

export function SyncButton() {
  const [state, action, pending] = useActionState<SyncActionState>(syncAction, null);
  return (
    <form action={action} className="flex items-center gap-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-neutral-900 disabled:opacity-60"
      >
        {pending ? "Syncing…" : "Sync"}
      </button>
      <span
        role="status"
        className={state?.ok === false ? "text-sm text-red-800" : "text-sm text-neutral-600"}
      >
        {pending ? "" : state?.message}
      </span>
    </form>
  );
}
