"use server";

import { revalidatePath } from "next/cache";
import { ActionError, createAction, createActionInput, setActionStatus } from "@/lib/actions";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db/client";

// Server Actions check the owner themselves (docs/standards.md section 4).

export type ActionFormState = {
  ok: boolean;
  message: string;
  title: string;
  notes: string;
  dueOn: string;
} | null;

const text = (formData: FormData, name: string) => {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
};

export async function createActionAction(
  _prev: ActionFormState,
  formData: FormData,
): Promise<ActionFormState> {
  await requireOwner();
  const fields = {
    title: text(formData, "title"),
    notes: text(formData, "notes"),
    dueOn: text(formData, "dueOn"),
  };
  // Validate here as well, to show the first problem in plain words instead of the full report.
  const parsed = createActionInput.safeParse({
    title: fields.title,
    notes: fields.notes.trim() || undefined,
    dueOn: fields.dueOn || undefined,
    itemId: text(formData, "itemId") || undefined,
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message, ...fields };
  try {
    await createAction(getDb(), parsed.data);
  } catch (e) {
    if (e instanceof ActionError) return { ok: false, message: e.message, ...fields };
    throw e;
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Action added.", title: "", notes: "", dueOn: "" };
}

export async function setActionStatusAction(formData: FormData): Promise<void> {
  await requireOwner();
  // A conflict means the status changed in another tab; the page then shows the current state.
  await setActionStatus(getDb(), {
    actionId: formData.get("actionId"),
    status: formData.get("status"),
  }).catch((e: unknown) => {
    if (!(e instanceof ActionError && e.code === "conflict")) throw e;
  });
  revalidatePath("/", "layout");
}
