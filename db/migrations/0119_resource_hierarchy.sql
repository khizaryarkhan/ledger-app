-- Resource hierarchy, designations and employee logins (2026-11-01). Additive only.
CREATE TABLE IF NOT EXISTS "resource_designations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "name" varchar(80) NOT NULL,
  "access_level" varchar(8) DEFAULT 'self' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "status" varchar(16) DEFAULT 'active' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_designations_org_idx" ON "resource_designations" ("org_id", "status");
--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "manager_id" uuid REFERENCES "resources"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "designation_id" uuid REFERENCES "resource_designations"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "department" varchar(80);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resources_org_manager_idx" ON "resources" ("org_id", "manager_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "resources_org_user_unique" ON "resources" ("org_id", "user_id") WHERE "user_id" IS NOT NULL;
