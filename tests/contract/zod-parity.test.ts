import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { feedbackFileSchema, runFileSchema } from "@/lib/contract";

const root = join(import.meta.dirname, "..", "..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(join(root, path), "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const ajvRun = ajv.compile(readJson("schemas/agent-run.schema.json") as object);
const ajvFeedback = ajv.compile(readJson("schemas/feedback.schema.json") as object);

type Json = Record<string, unknown>;
const baseRun = readJson("schemas/examples/agent-run.example.json") as Json;
const baseFeedback = readJson("schemas/examples/feedback.example.json") as Json;
const firstItem = (baseRun.items as Json[])[0]!;
const firstEntry = (baseFeedback.entries as Json[])[0]!;

const withItem = (patch: Json): Json => ({ ...baseRun, items: [{ ...firstItem, ...patch }] });
const withEntry = (patch: Json): Json => ({
  ...baseFeedback,
  entries: [{ ...firstEntry, ...patch }],
});
const without = (doc: Json, key: string): Json => {
  const copy = { ...doc };
  delete copy[key];
  return copy;
};

const runCases: [string, Json][] = [
  ["example", baseRun],
  ["minor version 1.3", { ...baseRun, contract_version: "1.3" }],
  ["major version 2.0", { ...baseRun, contract_version: "2.0" }],
  ["uppercase agent slug", { ...baseRun, agent: "Mail-Triage" }],
  ["unknown status", { ...baseRun, status: "done" }],
  ["timestamp without offset", { ...baseRun, started_at: "2026-11-18T06:48:12" }],
  ["timestamp in UTC", { ...baseRun, started_at: "2026-11-18T05:48:12Z" }],
  ["summary over 500 chars", { ...baseRun, summary: "x".repeat(501) }],
  ["missing items", without(baseRun, "items")],
  ["missing feedback_consumed", without(baseRun, "feedback_consumed")],
  ["extra top-level field", { ...baseRun, extra: true }],
  ["declared name and schedule", { ...baseRun, agent_name: "Mail", schedule: "0 7 * * *" }],
  ["empty declared name", { ...baseRun, agent_name: "" }],
  ["declared schedule over 200 chars", { ...baseRun, schedule: "x".repeat(201) }],
  ["declared schedule that is a number", { ...baseRun, schedule: 7 }],
  ["metric name with capitals", { ...baseRun, metrics: { Processed: 1 } }],
  ["metric that is a string", { ...baseRun, metrics: { processed: "41" } }],
  ["bad feedback id", { ...baseRun, feedback_consumed: ["fb-123"] }],
  ["iterations over 10", { ...baseRun, verification: { iterations: 11, result: "ok" } }],
  ["item with unknown kind", withItem({ kind: "new_kind" })],
  ["item kind with capitals", withItem({ kind: "NewKind" })],
  ["item with unknown severity", withItem({ severity: "urgent" })],
  ["item with empty title", withItem({ title: "" })],
  ["item source with bad type", withItem({ source: { type: "email" } })],
  ["item source with invalid url", withItem({ source: { type: "url", url: "not a url" } })],
  ["item with extra field", withItem({ extra: 1 })],
  ["201 items", { ...baseRun, items: Array.from({ length: 201 }, () => firstItem) }],
];

const feedbackCases: [string, Json][] = [
  ["example", baseFeedback],
  ["unknown feedback type", withEntry({ type: "delete_mail" })],
  ["extra entry field", withEntry({ extra: 1 })],
  ["extra top-level field", { ...baseFeedback, extra: 1 }],
  ["target with extra field", withEntry({ target: { thread: "x" } })],
  ["note over 1000 chars", withEntry({ note: "x".repeat(1001) })],
];

describe("Zod schemas agree with the JSON Schemas", () => {
  it.each(runCases)("run file: %s", (_name, doc) => {
    expect(runFileSchema.safeParse(doc).success).toBe(ajvRun(doc));
  });

  it.each(feedbackCases)("feedback file: %s", (_name, doc) => {
    expect(feedbackFileSchema.safeParse(doc).success).toBe(ajvFeedback(doc));
  });
});
