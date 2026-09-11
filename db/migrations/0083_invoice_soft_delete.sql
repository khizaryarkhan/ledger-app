-- Soft delete for invoices removed in QuickBooks. Previously these were marked
-- paymentStatus='Written Off' + collectionStage='Closed', which both left them
-- cluttering every list and mislabelled them: "written off" is a real AR
-- concept (debt pursued and given up on), a deleted invoice never existed.
-- Hidden rather than removed so a misfiring deletion detection can be undone.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_org_deleted_idx" ON "invoices" ("org_id","deleted_at");
