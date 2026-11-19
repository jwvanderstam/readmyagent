import { z } from "zod";

// Zod mirrors of the JSON Schemas in /schemas, which stay the normative source.
// tests/contract/zod-parity.test.ts checks that both accept and reject the same documents.

/** Agent slug, as in `agent` of a run file. Also validates slugs entered in the app. */
export const agentSlugSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const slug = agentSlugSchema;
const contractVersion = z.string().regex(/^1\.[0-9]+$/);
const dateTime = z.iso.datetime({ offset: true });
const feedbackId = z.string().regex(/^fb_[A-Za-z0-9]+$/);

export const SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
export const RUN_STATUSES = ["ok", "warning", "failed"] as const;
export const FEEDBACK_TYPES = [
  "correct",
  "incorrect",
  "keep_sender",
  "archive_sender",
  "knowledge_sender",
  "dismiss",
  "rule",
] as const;

export const runItemSchema = z.looseObject({
  fingerprint: z.string().min(1).max(256),
  kind: z
    .string()
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/),
  severity: z.enum(SEVERITIES),
  title: z.string().min(1).max(200),
  body: z.string().max(4000).optional(),
  source: z
    .looseObject({
      type: z.enum(["gmail_thread", "commit", "pull_request", "url", "file", "other"]),
      ref: z.string().max(512).optional(),
      url: z.url().max(2048).optional(),
    })
    .optional(),
  suggested_action: z.string().max(500).optional(),
});

export const runFileSchema = z.looseObject({
  contract_version: contractVersion,
  agent: slug,
  run_id: z.string().min(1).max(128),
  started_at: dateTime,
  finished_at: dateTime,
  status: z.enum(RUN_STATUSES),
  summary: z.string().max(500),
  metrics: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), z.number()).optional(),
  items: z.array(runItemSchema).max(200),
  verification: z.looseObject({
    iterations: z.int().min(0).max(10),
    result: z.enum(["ok", "issues", "skipped"]),
    notes: z.array(z.string().max(500)).optional(),
  }),
  feedback_consumed: z.array(feedbackId),
  log_file: z.string().max(256).optional(),
  // Contract 1.1: the agent describes itself, so the reader can register and update it (ADR-0009).
  agent_name: z.string().min(1).max(100).optional(),
  schedule: z.string().min(1).max(200).optional(),
});

export const feedbackEntrySchema = z.strictObject({
  id: feedbackId,
  agent: slug,
  type: z.enum(FEEDBACK_TYPES),
  target: z
    .strictObject({
      fingerprint: z.string().max(256).optional(),
      run_id: z.string().max(128).optional(),
    })
    .optional(),
  note: z.string().max(1000).optional(),
  created_at: dateTime,
});

export const feedbackFileSchema = z.strictObject({
  contract_version: contractVersion,
  generated_at: dateTime,
  entries: z.array(feedbackEntrySchema).max(500),
});

export type RunFile = z.infer<typeof runFileSchema>;
export type RunItem = z.infer<typeof runItemSchema>;
export type FeedbackFile = z.infer<typeof feedbackFileSchema>;
export type FeedbackEntry = z.infer<typeof feedbackEntrySchema>;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
