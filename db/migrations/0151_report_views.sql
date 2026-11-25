-- Saved report views: a person's named choice of period / columns / compare-to for one report (settings only, never figures).
-- ADDITIVE: one new table and two indexes. Nothing existing is touched.
CREATE TABLE IF NOT EXISTS "report_views" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "report_key" varchar(64) NOT NULL,
  "name" varchar(80) NOT NULL,
  "params" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_views_user_idx" ON "report_views" ("org_id", "user_id", "report_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "report_views_one_name" ON "report_views" ("org_id", "user_id", "report_key", lower("name"));
