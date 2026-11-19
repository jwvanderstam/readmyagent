"use client";

import { useActionState } from "react";
import { type AgentFormState, createAgentAction, updateAgentAction } from "./actions";

type Props = {
  mode: "create" | "edit";
  initial: { slug: string; name: string; schedule: string; graceMinutes: number; active: boolean };
  defaultTimezone: string;
};

const input =
  "mt-1 block w-full rounded border border-neutral-300 px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-neutral-900 aria-[invalid=true]:border-red-600";

function Field(props: {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  children: (describedBy: string | undefined) => React.ReactNode;
}) {
  const hintId = props.hint ? `${props.name}-hint` : undefined;
  const errorId = props.error ? `${props.name}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={props.name} className="block text-sm font-medium">
        {props.label}
      </label>
      {props.children(describedBy)}
      {props.hint && (
        <p id={hintId} className="mt-1 text-sm text-neutral-600">
          {props.hint}
        </p>
      )}
      {props.error && (
        <p id={errorId} className="mt-1 text-sm text-red-800">
          {props.error}
        </p>
      )}
    </div>
  );
}

export function AgentForm({ mode, initial, defaultTimezone }: Props) {
  const [state, action, pending] = useActionState<AgentFormState, FormData>(
    mode === "create" ? createAgentAction : updateAgentAction,
    null,
  );
  const v = state?.values;
  const e = state?.errors ?? {};
  const value = (name: keyof Props["initial"]) => v?.[name] ?? String(initial[name]);

  return (
    <form action={action} className="space-y-4" noValidate>
      {mode === "create" ? (
        <Field
          name="slug"
          label="Slug"
          hint="Exactly the `agent` value in the agent's run files, for example mail-triage. Cannot be changed later."
          error={e.slug}
        >
          {(describedBy) => (
            <input
              id="slug"
              name="slug"
              required
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              defaultValue={value("slug")}
              aria-invalid={Boolean(e.slug)}
              aria-describedby={describedBy}
              className={input}
            />
          )}
        </Field>
      ) : (
        <input type="hidden" name="slug" value={initial.slug} />
      )}

      <Field name="name" label="Name" error={e.name}>
        {(describedBy) => (
          <input
            id="name"
            name="name"
            required
            defaultValue={value("name")}
            aria-invalid={Boolean(e.name)}
            aria-describedby={describedBy}
            className={input}
          />
        )}
      </Field>

      <Field
        name="schedule"
        label="Schedule"
        hint={`Cron expression of the scheduled task. Add CRON_TZ=<zone> in front for its timezone; without it, ${defaultTimezone} applies. An agent that declares its schedule in its run files overwrites this on its next run.`}
        error={e.schedule}
      >
        {(describedBy) => (
          <input
            id="schedule"
            name="schedule"
            required
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="CRON_TZ=Europe/Amsterdam 0 7 * * *"
            defaultValue={value("schedule")}
            aria-invalid={Boolean(e.schedule)}
            aria-describedby={describedBy}
            className={`${input} font-mono`}
          />
        )}
      </Field>

      <Field
        name="graceMinutes"
        label="Grace window (minutes)"
        hint="How long after its scheduled time a run may arrive before it counts as missing."
        error={e.graceMinutes}
      >
        {(describedBy) => (
          <input
            id="graceMinutes"
            name="graceMinutes"
            type="number"
            inputMode="numeric"
            min={15}
            max={1440}
            required
            defaultValue={value("graceMinutes")}
            aria-invalid={Boolean(e.graceMinutes)}
            aria-describedby={describedBy}
            className={input}
          />
        )}
      </Field>

      <div className="flex items-center gap-2">
        <input
          id="active"
          name="active"
          type="checkbox"
          defaultChecked={v ? v.active === "on" : initial.active}
          className="size-5"
        />
        <label htmlFor="active" className="text-sm">
          Active. Inactive agents are not checked for missing runs.
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-neutral-900 px-4 py-2 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 disabled:opacity-60"
        >
          {pending ? "Saving…" : mode === "create" ? "Add agent" : "Save"}
        </button>
        <p
          role="status"
          className={Object.keys(e).length ? "text-sm text-red-800" : "text-sm text-neutral-600"}
        >
          {pending ? "" : state?.message}
        </p>
      </div>
    </form>
  );
}
