"use client";

import { useActionState } from "react";
import { createActionAction } from "./mutations";

const TITLE_MAX = 200;
const NOTES_MAX = 2000;
const input =
  "mt-1 block w-full rounded border border-neutral-300 px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-neutral-900";
const button =
  "rounded bg-neutral-900 px-4 py-2 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 disabled:opacity-60";

export function ActionForm({ itemId, defaultTitle }: { itemId?: string; defaultTitle?: string }) {
  const [state, action, pending] = useActionState(createActionAction, null);
  const failed = state?.ok === false;
  const id = itemId ? "item-action" : "new-action";
  return (
    // React resets the fields after each submit; defaultValue brings them back after a failure.
    <form action={action} className="space-y-3">
      {itemId && <input type="hidden" name="itemId" value={itemId} />}
      <div>
        <label htmlFor={`${id}-title`} className="block text-sm font-medium">
          Action
        </label>
        <input
          id={`${id}-title`}
          name="title"
          required
          maxLength={TITLE_MAX}
          defaultValue={failed ? state.title : (defaultTitle ?? "")}
          className={input}
        />
      </div>
      <div>
        <label htmlFor={`${id}-due`} className="block text-sm font-medium">
          Due <span className="font-normal text-neutral-600">(optional)</span>
        </label>
        <input
          id={`${id}-due`}
          name="dueOn"
          type="date"
          defaultValue={failed ? state.dueOn : ""}
          className={input}
        />
      </div>
      <div>
        <label htmlFor={`${id}-notes`} className="block text-sm font-medium">
          Notes <span className="font-normal text-neutral-600">(optional)</span>
        </label>
        <textarea
          id={`${id}-notes`}
          name="notes"
          rows={2}
          maxLength={NOTES_MAX}
          defaultValue={failed ? state.notes : ""}
          className={input}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={button}>
          {pending ? "Saving…" : "Add action"}
        </button>
        <p role="status" className={failed ? "text-sm text-red-800" : "text-sm text-neutral-600"}>
          {pending ? "" : state?.message}
        </p>
      </div>
    </form>
  );
}
