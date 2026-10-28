-- Production data points (2026-10-28): planned vs actual, delay reasons,
-- downtime and scrap reasons for Manufacturing Orders and job work.
-- Additive only — every existing row keeps working with nulls / zeros.
ALTER TABLE "manufacturing_orders" ADD COLUMN IF NOT EXISTS "original_due_date" date;
--> statement-breakpoint
ALTER TABLE "manufacturing_orders" ADD COLUMN IF NOT EXISTS "reschedule_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "manufacturing_orders" ADD COLUMN IF NOT EXISTS "delay_reason" varchar(32);
--> statement-breakpoint
ALTER TABLE "manufacturing_orders" ADD COLUMN IF NOT EXISTS "delay_note" text;
--> statement-breakpoint
ALTER TABLE "production_runs" ADD COLUMN IF NOT EXISTS "reject_reason" varchar(32);
--> statement-breakpoint
ALTER TABLE "production_runs" ADD COLUMN IF NOT EXISTS "reject_note" text;
--> statement-breakpoint
ALTER TABLE "production_runs" ADD COLUMN IF NOT EXISTS "operation_hours" jsonb;
--> statement-breakpoint
ALTER TABLE "job_work_orders" ADD COLUMN IF NOT EXISTS "original_expected_return_date" date;
--> statement-breakpoint
ALTER TABLE "job_work_orders" ADD COLUMN IF NOT EXISTS "return_revisions" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "job_work_orders" ADD COLUMN IF NOT EXISTS "delay_reason" varchar(32);
--> statement-breakpoint
ALTER TABLE "job_work_orders" ADD COLUMN IF NOT EXISTS "delay_note" text;
--> statement-breakpoint
ALTER TABLE "job_work_orders" ADD COLUMN IF NOT EXISTS "wastage_reason" varchar(32);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "production_downtime" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "mo_id" uuid REFERENCES "manufacturing_orders"("id") ON DELETE set null,
  "work_centre_id" uuid REFERENCES "work_centres"("id") ON DELETE set null,
  "started_at" timestamp NOT NULL,
  "ended_at" timestamp,
  "reason" varchar(32) NOT NULL,
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_downtime_org_idx" ON "production_downtime" ("org_id", "started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_downtime_mo_idx" ON "production_downtime" ("mo_id");
