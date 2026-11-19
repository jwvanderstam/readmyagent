import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunItem } from "@/lib/contract";
import type { Db } from "@/lib/db";
import { schema } from "@/lib/db";
import { createFeedback } from "@/lib/feedback";
import { formatRelative, safeHttpUrl } from "@/lib/format";
import { ingestRunFile } from "@/lib/ingest";
import { allowedTransitions, ItemError, setItemState } from "@/lib/items/state";
import {
  countAgents,
  countInbox,
  getItemDetail,
  getSyncStatus,
  isInboxView,
  listInbox,
} from "@/lib/reader/queries";
import { createTestDb } from "../helpers/test-db";

const { agents, items, syncRuns, ingestErrors } = schema;

const NOW = new Date("2026-11-18T12:00:00Z");
let db: Db;
let close: () => Promise<void>;

const item = (
  fingerprint: string,
  severity: RunItem["severity"],
  title = fingerprint,
): RunItem => ({
  fingerprint,
  kind: "finding",
  severity,
  title,
});

async function ingestRun(day: number, runItems: RunItem[]) {
  const dd = String(day).padStart(2, "0");
  const [sync] = await db.insert(syncRuns).values({ trigger: "manual" }).returning();
  await ingestRunFile(
    db,
    {
      driveFileId: `file-${dd}`,
      fileName: `run-${dd}.json`,
      content: JSON.stringify({
        contract_version: "1.0",
        agent: "test-agent",
        run_id: `test-agent-2026-11-${dd}-0700`,
        started_at: `2026-11-${dd}T07:00:00+01:00`,
        finished_at: `2026-11-${dd}T07:05:00+01:00`,
        status: "ok",
        summary: "Test run.",
        items: runItems,
        verification: { iterations: 1, result: "ok" },
        feedback_consumed: [],
      }),
    },
    { syncRunId: sync!.id, now: () => NOW },
  );
  await db.update(syncRuns).set({ status: "ok", finishedAt: NOW }).where(eq(syncRuns.id, sync!.id));
}

const idOf = async (fingerprint: string) =>
  (await db.select().from(items).where(eq(items.fingerprint, fingerprint)))[0]!.id;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(agents).values({ slug: "test-agent", name: "Test agent", schedule: "0 7 * * *" });
});

afterEach(async () => {
  await close();
});

describe("inbox", () => {
  it("lists open items, most severe first, then most recently seen", async () => {
    await ingestRun(16, [item("old-low", "low"), item("high", "high")]);
    await ingestRun(17, [item("new-low", "low")]);

    const rows = await listInbox(db, "open");

    expect(rows.map((r) => r.title)).toEqual(["high", "new-low", "old-low"]);
    expect(rows[0]).toMatchObject({ agentName: "Test agent", severity: "high", occurrences: 1 });
  });

  it("splits items over the open, acknowledged and closed views", async () => {
    await ingestRun(16, [item("a", "low"), item("b", "low"), item("c", "low"), item("d", "low")]);
    await setItemState(db, { itemId: await idOf("b"), state: "acknowledged" }, NOW);
    await setItemState(db, { itemId: await idOf("c"), state: "dismissed" }, NOW);
    await setItemState(db, { itemId: await idOf("d"), state: "acknowledged" }, NOW);
    await setItemState(db, { itemId: await idOf("d"), state: "done" }, NOW);

    expect(await countInbox(db)).toEqual({ open: 1, acknowledged: 1, closed: 2 });
    expect((await listInbox(db, "closed")).map((r) => r.title).sort()).toEqual(["c", "d"]);
  });

  it("accepts only known views from the URL", () => {
    expect(isInboxView("closed")).toBe(true);
    expect(isInboxView("toString")).toBe(false);
    expect(isInboxView(["open"])).toBe(false);
  });

  it("counts active agents for the empty state", async () => {
    expect(await countAgents(db)).toBe(1);
    await db.update(agents).set({ active: false });
    expect(await countAgents(db)).toBe(0);
  });
});

describe("item detail", () => {
  it("returns the item with the runs that reported it, newest first, and its feedback", async () => {
    await ingestRun(16, [item("a", "medium")]);
    await ingestRun(17, [item("a", "medium")]);
    const id = await idOf("a");
    await createFeedback(db, { agentSlug: "test-agent", itemId: id, type: "dismiss" }, NOW);

    const detail = await getItemDetail(db, id);

    expect(detail).toMatchObject({ title: "a", agentName: "Test agent", occurrences: 2 });
    expect(detail!.reportedIn.map((o) => o.fileRunId)).toEqual([
      "test-agent-2026-11-17-0700",
      "test-agent-2026-11-16-0700",
    ]);
    expect(detail!.feedback).toHaveLength(1);
  });

  it("returns null for an unknown item", async () => {
    expect(await getItemDetail(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

describe("item state", () => {
  it("follows the state machine of the data model", async () => {
    await ingestRun(16, [item("a", "low")]);
    const itemId = await idOf("a");

    await expect(setItemState(db, { itemId, state: "done" }, NOW)).rejects.toMatchObject({
      code: "conflict",
    });
    expect((await setItemState(db, { itemId, state: "acknowledged" }, NOW)).state).toBe(
      "acknowledged",
    );
    expect((await setItemState(db, { itemId, state: "done" }, NOW)).updatedAt).toEqual(NOW);
    expect((await setItemState(db, { itemId, state: "open" }, NOW)).state).toBe("open");
    expect(allowedTransitions("open")).toEqual(["acknowledged", "dismissed"]);
  });

  it("rejects invalid input and unknown items", async () => {
    await expect(setItemState(db, { itemId: "x", state: "done" })).rejects.toBeInstanceOf(
      ItemError,
    );
    await expect(
      setItemState(db, { itemId: "00000000-0000-4000-8000-000000000000", state: "done" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("sync status", () => {
  it("reports the latest sync and unresolved ingest errors", async () => {
    expect(await getSyncStatus(db)).toEqual({ last: null, openErrors: 0 });
    await ingestRun(16, []);
    const [sync] = await db.select().from(syncRuns);
    await db.insert(ingestErrors).values([
      { syncRunId: sync!.id, driveFileId: "x", fileName: "x.json", message: "bad" },
      {
        syncRunId: sync!.id,
        driveFileId: "y",
        fileName: "y.json",
        message: "bad",
        resolvedAt: NOW,
      },
    ]);

    const status = await getSyncStatus(db);
    expect(status.last?.status).toBe("ok");
    expect(status.openErrors).toBe(1);
  });
});

describe("format", () => {
  it("allows only http and https links from agent data", () => {
    expect(safeHttpUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,x")).toBeNull();
    expect(safeHttpUrl("/relative")).toBeNull();
    expect(safeHttpUrl(42)).toBeNull();
  });

  it("formats relative times", () => {
    const at = (ms: number) => new Date(NOW.getTime() - ms);
    const rel = (ms: number) => formatRelative(at(ms), NOW, "Europe/Amsterdam");
    expect(rel(10_000)).toBe("just now");
    expect(rel(5 * 60_000)).toBe("5 min ago");
    expect(rel(3 * 3600_000)).toBe("3 h ago");
    expect(rel(24 * 3600_000)).toBe("1 day ago");
    expect(rel(10 * 24 * 3600_000)).toBe("8 Nov, 13:00");
  });
});
