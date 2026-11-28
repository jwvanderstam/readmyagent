import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");
const schemasDir = join(root, "schemas");
const examplesDir = join(schemasDir, "examples");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateRun = ajv.compile(readJson(join(schemasDir, "agent-run.schema.json")) as object);
const validateFeedback = ajv.compile(readJson(join(schemasDir, "feedback.schema.json")) as object);

function validatorFor(kind: "run" | "feedback") {
  return kind === "run" ? validateRun : validateFeedback;
}

function expectValid(kind: "run" | "feedback", data: unknown) {
  const validate = validatorFor(kind);
  const valid = validate(data);
  expect(validate.errors ?? [], ajv.errorsText(validate.errors)).toEqual([]);
  expect(valid).toBe(true);
}

describe("schemas/examples", () => {
  const files = readdirSync(examplesDir).filter((f) => f.endsWith(".json"));

  it("contains examples for both schemas", () => {
    expect(files).toEqual(
      expect.arrayContaining(["agent-run.example.json", "feedback.example.json"]),
    );
  });

  it.each(files)("%s validates against its schema", (file) => {
    const kind = file.startsWith("feedback") ? "feedback" : "run";
    expectValid(kind, readJson(join(examplesDir, file)));
  });
});

describe("docs/agent-contract.md examples", () => {
  const markdown = readFileSync(join(root, "docs", "agent-contract.md"), "utf8");
  const blocks = [...markdown.matchAll(/```json\r?\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");

  it("contains a run example and a feedback example", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(2);
  });

  it.each(blocks.map((b, i) => [i, b] as const))("block %i validates", (_i, block) => {
    const data = JSON.parse(block) as Record<string, unknown>;
    expectValid("entries" in data ? "feedback" : "run", data);
  });
});

describe("docs/contracts/agent-instructions.md", () => {
  const markdown = readFileSync(join(root, "docs", "contracts", "agent-instructions.md"), "utf8");
  const blocks = [...markdown.matchAll(/```json\r?\n([\s\S]*?)```/g)].map(
    (m) => JSON.parse(m[1] ?? "") as Record<string, unknown>,
  );

  it("has one valid example per agent", () => {
    expect(blocks.map((b) => b.agent)).toEqual(["mail-triage", "localchat-wachter", "weekbrief"]);
    for (const block of blocks) expectValid("run", block);
  });

  it("embeds the current run schema inside the paste block", () => {
    const paste = /<!-- PASTE START -->([\s\S]*?)<!-- PASTE END -->/.exec(markdown)?.[1] ?? "";
    const embedded = /```json-schema\r?\n([\s\S]*?)```/.exec(paste)?.[1] ?? "";
    expect(JSON.parse(embedded)).toEqual(readJson(join(schemasDir, "agent-run.schema.json")));
  });
});
