-- Resources Phase D (2026-11-02): hours-over-plan enquiries.
--
-- Additive. Nothing opens an enquiry until the nightly assessor runs, and it
-- only ever assesses a month that has already ended, so no existing data
-- changes meaning on deploy.
--
-- The unique index is load-bearing: it is what makes re-running the assessor
-- safe rather than something that has to remember what it did.
--
-- One command per chunk (neon-http sends each as a prepared statement).

CREATE TABLE IF NOT EXISTS "hours_variance_enquiries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "resource_id" uuid NOT NULL REFERENCES "resources"("id") ON DELETE cascade,
  "assignable_type" varchar(24) NOT NULL,
  "assignable_id" uuid NOT NULL,
  "month" varchar(7) NOT NULL,
  "kind" varchar(16) NOT NULL,
  "planned_hours" numeric(10,2) DEFAULT '0' NOT NULL,
  "actual_hours" numeric(10,2) DEFAULT '0' NOT NULL,
  "assigned_to" uuid REFERENCES "resources"("id") ON DELETE set null,
  "status" varchar(16) DEFAULT 'open' NOT NULL,
  "response" text,
  "responded_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "responded_at" timestamp,
  "closed_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "closed_at" timestamp,
  "escalated_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hours_variance_once_unique" ON "hours_variance_enquiries" ("org_id", "resource_id", "assignable_type", "assignable_id", "month");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hours_variance_org_status_idx" ON "hours_variance_enquiries" ("org_id", "status", "month");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hours_variance_org_assigned_idx" ON "hours_variance_enquiries" ("org_id", "assigned_to", "status");
