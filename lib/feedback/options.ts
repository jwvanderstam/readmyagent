import type { FeedbackType } from "@/lib/contract";

/** What the owner sees when choosing feedback on an item. Mirrors agent contract section 3.2. */
export const ITEM_FEEDBACK_OPTIONS = [
  { type: "correct", label: "Correct", hint: "The agent handled this right. Keep doing it." },
  {
    type: "incorrect",
    label: "Incorrect",
    hint: "The handling was wrong. Explain the right handling in the note.",
  },
  { type: "dismiss", label: "Stop reporting", hint: "The agent no longer reports this item." },
  { type: "keep_sender", label: "Keep sender", hint: "Never propose this sender for deletion." },
  {
    type: "archive_sender",
    label: "Archive sender",
    hint: "Always archive mail from this sender.",
  },
  {
    type: "knowledge_sender",
    label: "Knowledge sender",
    hint: "Always label mail from this sender as knowledge.",
  },
] as const satisfies readonly {
  type: Exclude<FeedbackType, "rule">;
  label: string;
  hint: string;
}[];

export type ItemFeedbackType = (typeof ITEM_FEEDBACK_OPTIONS)[number]["type"];

const SENDER_TYPES: readonly FeedbackType[] = ["keep_sender", "archive_sender", "knowledge_sender"];

/** Sender feedback only makes sense for items about mail. */
export function feedbackOptionsFor(item: { fingerprint: string; source: unknown }) {
  const source = item.source as { type?: unknown } | null;
  const aboutMail = item.fingerprint.startsWith("sender:") || source?.type === "gmail_thread";
  return ITEM_FEEDBACK_OPTIONS.filter((o) => aboutMail || !SENDER_TYPES.includes(o.type));
}

/** Pending and published feedback can still be withdrawn; see withdrawFeedback. */
export const canWithdraw = (status: string) => status === "pending" || status === "published";
