import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import { ingestRunFile, listIngestErrors, resolveIngestError } from "@/lib/ingest";
import { createTestDb } from "../helpers/test-db";

const { syncRuns } = schema;

const NOW = new Date("2026-11-20T12:00:00Z");
const LATER = new Date("2026-11-20T13:00:00Z");
let db: Db;
let close: () => Promise<void>;
let syncRunId: string;

const broken = { driveFileId: "file-bad", fileName: "run-bad.json", content: "{ not json" };

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const [sync] = await db.insert(syncRuns).values({ trigger: "manual" }).returning();
  syncRunId = sync!.id;
});

afterEach(() => close());

describe("ingest errors", () => {
  it("lists an invalid file as open until it is resolved by hand", async () => {
    await ingestRunFile(db, broken, { syncRunId, now: () => NOW });
    const before = await listIngestErrors(db);
    expect(before.open).toHaveLength(1);
    expect(before.open[0]).toMatchObject({ fileName: "run-bad.json", driveFileId: "file-bad" });

    expect(await resolveIngestError(db, before.open[0]!.id, LATER)).toEqual({ ok: true });
    const after = await listIngestErrors(db);
    expect(after.open).toHaveLength(0);
    expect(after.resolved[0]).toMatchObject({ id: before.open[0]!.id, resolvedAt: LATER });

    // Resolving again is harmless.
    expect(await resolveIngestError(db, before.open[0]!.id)).toEqual({ ok: true });
  });

  it("opens a new error when the file is still invalid on the next sync", async () => {
    await ingestRunFile(db, broken, { syncRunId, now: () => NOW });
    const [first] = (await listIngestErrors(db)).open;
    await resolveIngestError(db, first!.id, LATER);
    await ingestRunFile(db, broken, { syncRunId, now: () => LATER });
    const { open } = await listIngestErrors(db);
    expect(open).toHaveLength(1);
    expect(open[0]!.id).not.toBe(first!.id);
  });

  it("rejects an invalid or unknown ID", async () => {
    expect(await resolveIngestError(db, "nope")).toEqual({ ok: false, code: "invalid_input" });
    expect(await resolveIngestError(db, "00000000-0000-4000-8000-000000000000")).toEqual({
      ok: false,
      code: "not_found",
    });
  });
});
