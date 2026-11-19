"use client";

import { useActionState } from "react";
import {
  createItemFeedbackAction,
  createRuleAction,
  type FeedbackFormState,
  withdrawFeedbackAction,
} from "./feedback-actions";

const NOTE_MAX = 1000;
const button =
  "rounded bg-neutral-900 px-4 py-2 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 disabled:opacity-60";
const textarea =
  "mt-1 block w-full rounded border border-neutral-300 px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-neutral-900";

function Status({ state, pending }: { state: FeedbackFormState; pending: boolean }) {
  return (
    <p
      role="status"
      className={state?.ok === false ? "text-sm text-red-800" : "text-sm text-neutral-600"}
    >
      {pending ? "" : state?.message}
    </p>
  );
}

type Option = { type: string; label: string; hint: string };

export function ItemFeedbackForm(props: { agentSlug: string; itemId: string; options: Option[] }) {
  const [state, action, pending] = useActionState(createItemFeedbackAction, null);
  return (
    // React resets the fields after each submit; defaultValue brings them back after a failure.
    <form action={action} className="space-y-3">
      <input type="hidden" name="agentSlug" value={props.agentSlug} />
      <input type="hidden" name="itemId" value={props.itemId} />
      <fieldset>
        <legend className="text-sm font-medium">What should the agent learn?</legend>
        <div className="mt-1 space-y-1">
          {props.options.map((o) => (
            <label key={o.type} className="flex items-start gap-2 py-1 text-sm">
              <input
                type="radio"
                name="type"
                value={o.type}
                defaultChecked={state?.ok === false && state.type === o.type}
                className="mt-0.5 size-5 shrink-0"
              />
              <span>
                <span className="font-medium">{o.label}</span>
                <span className="block text-neutral-600">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="feedback-note" className="block text-sm font-medium">
          Note
        </label>
        <textarea
          id="feedback-note"
          name="note"
          rows={3}
          maxLength={NOTE_MAX}
          defaultValue={state?.ok === false ? state.note : ""}
          aria-describedby="feedback-note-hint"
          className={textarea}
        />
        <p id="feedback-note-hint" className="mt-1 text-sm text-neutral-600">
          Required for Incorrect. The agent reads it, so write it as an instruction.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={button}>
          {pending ? "Saving…" : "Give feedback"}
        </button>
        <Status state={state} pending={pending} />
      </div>
    </form>
  );
}

export function RuleForm({ agentSlug }: { agentSlug: string }) {
  const [state, action, pending] = useActionState(createRuleAction, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="agentSlug" value={agentSlug} />
      <div>
        <label htmlFor="rule-note" className="block text-sm font-medium">
          New rule
        </label>
        <textarea
          id="rule-note"
          name="note"
          rows={3}
          maxLength={NOTE_MAX}
          required
          defaultValue={state?.ok === false ? state.note : ""}
          aria-describedby="rule-note-hint"
          className={textarea}
        />
        <p id="rule-note-hint" className="mt-1 text-sm text-neutral-600">
          A standing instruction in plain language, for example: Never report newsletters as urgent.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={button}>
          {pending ? "Saving…" : "Add rule"}
        </button>
        <Status state={state} pending={pending} />
      </div>
    </form>
  );
}

export function WithdrawButton({ feedbackId }: { feedbackId: string }) {
  return (
    <form action={withdrawFeedbackAction}>
      <input type="hidden" name="feedbackId" value={feedbackId} />
      <button
        type="submit"
        className="text-sm text-neutral-700 underline underline-offset-4 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-neutral-900"
      >
        Withdraw
      </button>
    </form>
  );
}
