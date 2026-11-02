-- Resources Phase A (2026-11-02): approval follows the project's lead, and a
-- returned entry becomes a conversation.
--
-- Additive only. `projects.lead_resource_id` is nullable and nothing populates
-- it, so until an org names a lead every project line keeps routing to the
-- person's line manager exactly as it does today.
--
-- One command per chunk (neon-http sends each as a prepared statement).

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "lead_resource_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "projects"
    ADD CONSTRAINT "projects_lead_resource_id_resources_id_fk"
    FOREIGN KEY ("lead_resource_id") REFERENCES "resources"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_org_lead_idx" ON "projects" ("org_id", "lead_resource_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "timesheet_returns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "time_entry_id" uuid NOT NULL REFERENCES "time_entries"("id") ON DELETE cascade,
  "resource_id" uuid NOT NULL REFERENCES "resources"("id") ON DELETE cascade,
  "returned_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "reason" text NOT NULL,
  "acknowledged_at" timestamp,
  "response" text,
  "responded_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "timesheet_returns_org_resource_idx" ON "timesheet_returns" ("org_id", "resource_id", "acknowledged_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "timesheet_returns_entry_idx" ON "timesheet_returns" ("time_entry_id");
