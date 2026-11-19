"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import {
  createFeedback,
  createFeedbackInput,
  FeedbackError,
  withdrawFeedback,
} from "@/lib/feedback";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { publishFeedbackNow } from "@/lib/sync/server";

// Server Actions check the owner themselves (docs/standards.md section 4).

export type FeedbackFormState = { ok: boolean; message: string; type: string; note: string } | null;

const text = (formData: FormData, name: string) => {
  const v = formData.get(name);
  return typeof v === "string" ? v : "";
};

async function create(input: {
  agentSlug: string;
  itemId?: string;
  type: string;
  note: string;
}): Promise<FeedbackFormState> {
  // Validate here as well, to show the first problem in plain words instead of the full report.
  const parsed = createFeedbackInput.safeParse({
    agentSlug: input.agentSlug,
    itemId: input.itemId,
    type: input.type,
    note: input.note.trim() || undefined,
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]!.message,
      type: input.type,
      note: input.note,
    };
  }
  try {
    await createFeedback(getDb(), parsed.data);
  } catch (e) {
    if (e instanceof FeedbackError) {
      return { ok: false, message: e.message, type: input.type, note: input.note };
    }
    throw e;
  }
  after(publishFeedbackNow);
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved. The agent picks it up on its next run.", type: "", note: "" };
}

export async function createItemFeedbackAction(
  _prev: FeedbackFormState,
  formData: FormData,
): Promise<FeedbackFormState> {
  await requireOwner();
  const note = text(formData, "note");
  const type = text(formData, "type");
  if (!type) return { ok: false, message: "Choose what the agent should learn.", type, note };
  return create({
    agentSlug: text(formData, "agentSlug"),
    itemId: text(formData, "itemId"),
    type,
    note,
  });
}

export async function createRuleAction(
  _prev: FeedbackFormState,
  formData: FormData,
): Promise<FeedbackFormState> {
  await requireOwner();
  return create({
    agentSlug: text(formData, "agentSlug"),
    type: "rule",
    note: text(formData, "note"),
  });
}

export async function withdrawFeedbackAction(formData: FormData): Promise<void> {
  await requireOwner();
  // A conflict means the agent consumed it in the meantime; the page then shows that state.
  await withdrawFeedback(getDb(), text(formData, "feedbackId")).catch((e: unknown) => {
    if (!(e instanceof FeedbackError)) throw e;
  });
  after(publishFeedbackNow);
  revalidatePath("/", "layout");
}
