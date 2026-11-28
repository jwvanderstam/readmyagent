CREATE TYPE "public"."parse_status" AS ENUM('ok', 'partial');--> statement-breakpoint
CREATE TYPE "public"."run_source" AS ENUM('json', 'markdown');--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "source" "run_source" DEFAULT 'json' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "markdown" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "parse_status" "parse_status";