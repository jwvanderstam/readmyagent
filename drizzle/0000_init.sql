CREATE TYPE "public"."action_status" AS ENUM('todo', 'doing', 'done', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."feedback_status" AS ENUM('pending', 'published', 'consumed', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."feedback_type" AS ENUM('correct', 'incorrect', 'keep_sender', 'archive_sender', 'knowledge_sender', 'dismiss', 'rule');--> statement-breakpoint
CREATE TYPE "public"."item_state" AS ENUM('open', 'acknowledged', 'done', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('ok', 'warning', 'failed');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('info', 'low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('running', 'ok', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sync_trigger" AS ENUM('cron', 'manual', 'on_open');--> statement-breakpoint
CREATE TABLE "actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid,
	"title" text NOT NULL,
	"notes" text,
	"due_on" date,
	"status" "action_status" DEFAULT 'todo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"schedule" text NOT NULL,
	"grace_minutes" integer DEFAULT 180 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_slug" text NOT NULL,
	"item_id" uuid,
	"type" "feedback_type" NOT NULL,
	"target" jsonb,
	"note" text,
	"status" "feedback_status" DEFAULT 'pending' NOT NULL,
	"published_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"consumed_by_run" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sync_run_id" uuid NOT NULL,
	"drive_file_id" text NOT NULL,
	"file_name" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "item_occurrences" (
	"item_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	CONSTRAINT "item_occurrences_item_id_run_id_pk" PRIMARY KEY("item_id","run_id")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_slug" text NOT NULL,
	"fingerprint" text NOT NULL,
	"kind" text NOT NULL,
	"severity" "severity" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"source" jsonb,
	"suggested_action" text,
	"state" "item_state" DEFAULT 'open' NOT NULL,
	"first_seen_run_id" uuid NOT NULL,
	"last_seen_run_id" uuid NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_agent_fingerprint_unique" UNIQUE("agent_slug","fingerprint")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_slug" text NOT NULL,
	"run_id" text NOT NULL,
	"drive_file_id" text NOT NULL,
	"log_file_id" text,
	"contract_version" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"status" "run_status" NOT NULL,
	"summary" text NOT NULL,
	"metrics" jsonb,
	"verification" jsonb NOT NULL,
	"raw" jsonb NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runs_drive_file_id_unique" UNIQUE("drive_file_id"),
	CONSTRAINT "runs_agent_run_id_unique" UNIQUE("agent_slug","run_id")
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" "sync_trigger" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "sync_status" DEFAULT 'running' NOT NULL,
	"files_seen" integer DEFAULT 0 NOT NULL,
	"runs_ingested" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_agent_slug_agents_slug_fk" FOREIGN KEY ("agent_slug") REFERENCES "public"."agents"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_consumed_by_run_runs_id_fk" FOREIGN KEY ("consumed_by_run") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_errors" ADD CONSTRAINT "ingest_errors_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_occurrences" ADD CONSTRAINT "item_occurrences_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_occurrences" ADD CONSTRAINT "item_occurrences_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_agent_slug_agents_slug_fk" FOREIGN KEY ("agent_slug") REFERENCES "public"."agents"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_first_seen_run_id_runs_id_fk" FOREIGN KEY ("first_seen_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_last_seen_run_id_runs_id_fk" FOREIGN KEY ("last_seen_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_agent_slug_agents_slug_fk" FOREIGN KEY ("agent_slug") REFERENCES "public"."agents"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actions_status_idx" ON "actions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "feedback_status_idx" ON "feedback" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ingest_errors_drive_file_idx" ON "ingest_errors" USING btree ("drive_file_id");--> statement-breakpoint
CREATE INDEX "items_state_idx" ON "items" USING btree ("state");--> statement-breakpoint
CREATE INDEX "runs_agent_started_idx" ON "runs" USING btree ("agent_slug","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "sync_runs_single_running_idx" ON "sync_runs" USING btree ("status") WHERE "sync_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "sync_runs_started_idx" ON "sync_runs" USING btree ("started_at" DESC NULLS LAST);