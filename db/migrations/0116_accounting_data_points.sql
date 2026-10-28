-- Accounting data points (2026-10-28): why a credit or manual journal was
-- raised, when a supplier's bill actually arrived, and who last edited a
-- document in place. Additive only — existing rows keep nulls.
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "reason_code" varchar(32);
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "received_date" varchar(16);
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "updated_at" timestamp;
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "updated_by" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_entries_org_reason_idx" ON "journal_entries" ("org_id", "reason_code") WHERE "reason_code" IS NOT NULL;
