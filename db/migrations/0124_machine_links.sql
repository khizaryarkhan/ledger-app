-- Equipment Phase Q1 (2026-11-03): link a machine to its work centre and fixed asset.
--
-- Additive only. Both columns are nullable and nothing back-fills them, so every
-- existing resource is unchanged until an admin links it.
--
-- The partial unique indexes make a work centre / asset belong to at most one
-- machine. They are the real guard: the API pre-checks for a friendly message,
-- but neon-http has no transactions, so only the index stops two concurrent saves.
--
-- One command per chunk (neon-http sends each as a prepared statement).

ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "work_centre_id" uuid;
--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN IF NOT EXISTS "fixed_asset_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "resources"
    ADD CONSTRAINT "resources_work_centre_id_work_centres_id_fk"
    FOREIGN KEY ("work_centre_id") REFERENCES "work_centres"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "resources"
    ADD CONSTRAINT "resources_fixed_asset_id_fixed_assets_id_fk"
    FOREIGN KEY ("fixed_asset_id") REFERENCES "fixed_assets"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "resources_org_work_centre_unique" ON "resources" ("org_id", "work_centre_id") WHERE "work_centre_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "resources_org_fixed_asset_unique" ON "resources" ("org_id", "fixed_asset_id") WHERE "fixed_asset_id" IS NOT NULL;
