import { describe, expect, it } from "vitest";
import { canWithdraw, createFeedbackInput, feedbackOptionsFor } from "@/lib/feedback";

const types = (item: { fingerprint: string; source: unknown }) =>
  feedbackOptionsFor(item).map((o) => o.type);

describe("feedbackOptionsFor", () => {
  it("offers sender feedback for items about mail", () => {
    expect(types({ fingerprint: "sender:news@example.com", source: null })).toContain(
      "keep_sender",
    );
    expect(types({ fingerprint: "thread:1", source: { type: "gmail_thread" } })).toEqual([
      "correct",
      "incorrect",
      "dismiss",
      "keep_sender",
      "archive_sender",
      "knowledge_sender",
    ]);
  });

  it("leaves sender feedback out for other items", () => {
    expect(types({ fingerprint: "pr:42", source: { type: "pull_request" } })).toEqual([
      "correct",
      "incorrect",
      "dismiss",
    ]);
  });

  it("offers only types the contract accepts for an item", () => {
    const itemId = "00000000-0000-4000-8000-000000000000";
    for (const type of types({ fingerprint: "sender:a@b.c", source: null })) {
      const note = type === "incorrect" ? "Archive it instead." : undefined;
      expect(createFeedbackInput.safeParse({ agentSlug: "a", itemId, type, note }).success).toBe(
        true,
      );
    }
  });
});

describe("canWithdraw", () => {
  it("allows withdrawing open feedback, and standing feedback also after consumption", () => {
    const statuses = ["pending", "published", "consumed", "withdrawn"];
    const allowed = (type: string) => statuses.filter((status) => canWithdraw({ status, type }));
    expect(allowed("correct")).toEqual(["pending", "published"]);
    expect(allowed("rule")).toEqual(["pending", "published", "consumed"]);
    expect(allowed("keep_sender")).toEqual(["pending", "published", "consumed"]);
  });
});
