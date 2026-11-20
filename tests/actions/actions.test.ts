import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ActionError,
  allowedActionTransitions,
  countActions,
  createAction,
  isActionView,
  listActions,
  listActionsForItem,
  setActionStatus,
} from "@/lib/actions";
import type { Db } from "@/lib/db";
import { formatDueDate } from "@/lib/format";
import { schema } from "@/lib/db";
import { createTestDb } from "../helpers/test-db";

const { agents, runs, items } = schema;

const NOW = new Date("2026-11-20T12:00:00Z");
const LATER = new Date("2026-11-21T12:00:00Z");
let db: Db;
let close: () => Promise<void>;
let itemId: string;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(agents).values({ slug: "test-agent", name: "Test", schedule: "0 7 * * *" });
  const [run] = await db
    .insert(runs)
    .values({
      agentSlug: "test-agent",
      runId: "r1",
      driveFileId: "f1",
      contractVersion: "1.0",
      startedAt: NOW,
      finishedAt: NOW,
      status: "ok",
      summary: "Test run.",
      verification: {},
      raw: {},
    })
    .returning();
  const [item] = await db
    .insert(items)
    .values({
      agentSlug: "test-agent",
      fingerprint: "fp-1",
      kind: "finding",
      severity: "high",
      title: "Renew the certificate",
      firstSeenRunId: run!.id,
      lastSeenRunId: run!.id,
    })
    .returning();
  itemId = item!.id;
});

afterEach(() => close());

describe("createAction", () => {
  it("creates a standalone action with trimmed fields", async () => {
    const a = await createAction(db, { title: "  Call the bank  ", notes: "  " }, NOW);
    expect(a).toMatchObject({ title: "Call the bank", notes: null, itemId: null, status: "todo" });
    expect(a.createdAt).toEqual(NOW);
  });

  it("links an action to an item", async () => {
    const a = await createAction(db, { title: "Renew", itemId, dueOn: "2026-11-30" }, NOW);
    expect(a).toMatchObject({ itemId, dueOn: "2026-11-30" });
    expect(await listActionsForItem(db, itemId)).toHaveLength(1);
  });

  it("rejects an empty title, a bad date and an unknown item", async () => {
    await expect(createAction(db, { title: " " })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(createAction(db, { title: "x", dueOn: "30-11-2026" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(
      createAction(db, { title: "x", itemId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("setActionStatus", () => {
  it("sets completedAt on done and clears it on reopen", async () => {
    const a = await createAction(db, { title: "x" }, NOW);
    const done = await setActionStatus(db, { actionId: a.id, status: "done" }, LATER);
    expect(done).toMatchObject({ status: "done", completedAt: LATER, updatedAt: LATER });
    const reopened = await setActionStatus(db, { actionId: a.id, status: "todo" }, LATER);
    expect(reopened).toMatchObject({ status: "todo", completedAt: null });
  });

  it("rejects a transition that is not allowed", async () => {
    const a = await createAction(db, { title: "x" }, NOW);
    await setActionStatus(db, { actionId: a.id, status: "dropped" });
    const err = await setActionStatus(db, { actionId: a.id, status: "done" }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ActionError);
    expect(err).toMatchObject({ code: "conflict" });
  });

  it("rejects invalid input and an unknown action", async () => {
    await expect(setActionStatus(db, { actionId: "x", status: "done" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(
      setActionStatus(db, { actionId: "00000000-0000-4000-8000-000000000000", status: "done" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("allows reopening only from closed states", () => {
    expect(allowedActionTransitions("done")).toEqual(["todo"]);
    expect(allowedActionTransitions("todo")).toContain("doing");
  });
});

describe("listActions", () => {
  it("lists open actions by due date first, then newest, and closed ones separately", async () => {
    const noDue = await createAction(db, { title: "no due" }, NOW);
    const late = await createAction(db, { title: "late", dueOn: "2026-12-10" }, NOW);
    const soon = await createAction(db, { title: "soon", dueOn: "2026-11-25", itemId }, NOW);
    const closed = await createAction(db, { title: "closed" }, NOW);
    await setActionStatus(db, { actionId: closed.id, status: "done" }, LATER);

    const open = await listActions(db, "open");
    expect(open.map((a) => a.id)).toEqual([soon.id, late.id, noDue.id]);
    expect(open[0]).toMatchObject({ itemTitle: "Renew the certificate" });
    expect((await listActions(db, "closed")).map((a) => a.id)).toEqual([closed.id]);
    expect(await countActions(db)).toEqual({ open: 3, closed: 1 });
  });

  it("recognises views", () => {
    expect(isActionView("open")).toBe(true);
    expect(isActionView("toString")).toBe(false);
  });
});

describe("formatDueDate", () => {
  it("shows a calendar date without shifting it by timezone", () => {
    expect(formatDueDate("2026-11-30")).toBe("30 Nov");
  });
});
