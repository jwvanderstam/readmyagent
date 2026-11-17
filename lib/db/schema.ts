import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Every timestamp is timestamptz in UTC (docs/standards.md, section 5).
const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => tstz("created_at").notNull().defaultNow();

export const runStatus = pgEnum("run_status", ["ok", "warning", "failed"]);
export const severity = pgEnum("severity", ["info", "low", "medium", "high", "critical"]);
export const itemState = pgEnum("item_state", ["open", "acknowledged", "done", "dismissed"]);
export const feedbackType = pgEnum("feedback_type", [
  "correct",
  "incorrect",
  "keep_sender",
  "archive_sender",
  "knowledge_sender",
  "dismiss",
  "rule",
]);
export const feedbackStatus = pgEnum("feedback_status", [
  "pending",
  "published",
  "consumed",
  "withdrawn",
]);
export const actionStatus = pgEnum("action_status", ["todo", "doing", "done", "dropped"]);
export const syncTrigger = pgEnum("sync_trigger", ["cron", "manual", "on_open"]);
export const syncStatus = pgEnum("sync_status", ["running", "ok", "partial", "failed"]);

export const agents = pgTable("agents", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  schedule: text("schedule").notNull(),
  graceMinutes: integer("grace_minutes").notNull().default(180),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentSlug: text("agent_slug")
      .notNull()
      .references(() => agents.slug),
    runId: text("run_id").notNull(),
    driveFileId: text("drive_file_id").notNull().unique(),
    logFileId: text("log_file_id"),
    contractVersion: text("contract_version").notNull(),
    startedAt: tstz("started_at").notNull(),
    finishedAt: tstz("finished_at").notNull(),
    status: runStatus("status").notNull(),
    summary: text("summary").notNull(),
    metrics: jsonb("metrics").$type<Record<string, number>>(),
    verification: jsonb("verification").notNull(),
    raw: jsonb("raw").notNull(),
    ingestedAt: tstz("ingested_at").notNull().defaultNow(),
  },
  (t) => [
    unique("runs_agent_run_id_unique").on(t.agentSlug, t.runId),
    index("runs_agent_started_idx").on(t.agentSlug, t.startedAt.desc()),
  ],
);

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentSlug: text("agent_slug")
      .notNull()
      .references(() => agents.slug),
    fingerprint: text("fingerprint").notNull(),
    kind: text("kind").notNull(),
    severity: severity("severity").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    source: jsonb("source"),
    suggestedAction: text("suggested_action"),
    state: itemState("state").notNull().default("open"),
    firstSeenRunId: uuid("first_seen_run_id")
      .notNull()
      .references(() => runs.id),
    lastSeenRunId: uuid("last_seen_run_id")
      .notNull()
      .references(() => runs.id),
    occurrences: integer("occurrences").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("items_agent_fingerprint_unique").on(t.agentSlug, t.fingerprint),
    index("items_state_idx").on(t.state),
  ],
);

export const itemOccurrences = pgTable(
  "item_occurrences",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.runId] })],
);

export const feedback = pgTable(
  "feedback",
  {
    // `fb_` + ULID: the ID agents see in feedback.json.
    id: text("id").primaryKey(),
    agentSlug: text("agent_slug")
      .notNull()
      .references(() => agents.slug),
    itemId: uuid("item_id").references(() => items.id),
    type: feedbackType("type").notNull(),
    target: jsonb("target").$type<{ fingerprint?: string; run_id?: string }>(),
    note: text("note"),
    status: feedbackStatus("status").notNull().default("pending"),
    publishedAt: tstz("published_at"),
    consumedAt: tstz("consumed_at"),
    consumedByRun: uuid("consumed_by_run").references(() => runs.id),
    createdAt: createdAt(),
  },
  (t) => [index("feedback_status_idx").on(t.status)],
);

export const actions = pgTable(
  "actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id").references(() => items.id),
    title: text("title").notNull(),
    notes: text("notes"),
    dueOn: date("due_on", { mode: "string" }),
    status: actionStatus("status").notNull().default("todo"),
    createdAt: createdAt(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
    completedAt: tstz("completed_at"),
  },
  (t) => [index("actions_status_idx").on(t.status)],
);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trigger: syncTrigger("trigger").notNull(),
    startedAt: tstz("started_at").notNull().defaultNow(),
    finishedAt: tstz("finished_at"),
    status: syncStatus("status").notNull().default("running"),
    filesSeen: integer("files_seen").notNull().default(0),
    runsIngested: integer("runs_ingested").notNull().default(0),
    errors: integer("errors").notNull().default(0),
  },
  // The sync lock: the database itself allows at most one running sync.
  (t) => [
    uniqueIndex("sync_runs_single_running_idx")
      .on(t.status)
      .where(sql`${t.status} = 'running'`),
    index("sync_runs_started_idx").on(t.startedAt.desc()),
  ],
);

export const ingestErrors = pgTable(
  "ingest_errors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    syncRunId: uuid("sync_run_id")
      .notNull()
      .references(() => syncRuns.id),
    driveFileId: text("drive_file_id").notNull(),
    fileName: text("file_name").notNull(),
    message: text("message").notNull(),
    createdAt: createdAt(),
    resolvedAt: tstz("resolved_at"),
  },
  (t) => [index("ingest_errors_drive_file_idx").on(t.driveFileId)],
);
