-- Resources Phase B (2026-11-02): contracted hours with dates.
--
-- Additive only, and nothing back-fills it. Until a row exists for someone,
-- capacity falls back to resources.daily_capacity / working_days exactly as
-- before, so every existing utilisation figure is unchanged on deploy.
--
-- One command per chunk (neon-http sends each as a prepared statement).

CREATE TABLE IF NOT EXISTS "resource_working_hours" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "resource_id" uuid NOT NULL REFERENCES "resources"("id") ON DELETE cascade,
  "hours_per_day" numeric(6,2) NOT NULL,
  "working_days" integer[],
  "effective_from" date NOT NULL,
  "effective_to" date,
  "note" varchar(160),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_working_hours_org_resource_from_idx" ON "resource_working_hours" ("org_id", "resource_id", "effective_from");
