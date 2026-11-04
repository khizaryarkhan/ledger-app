-- Invoices QuickBooks deleted or merged away, still live here as "Written Off".
-- Before 0083 a QuickBooks delete marked the row payment_status='Written Off' +
-- Closed instead of soft-deleting it, and the Merge webhook path kept doing so
-- until 2026-11-04. Nothing else in the app writes 'Written Off', so every live
-- mirrored row with that status is one of these. Left live they kept their old
-- balance and were counted by the sync log's QuickBooks AR figure and by
-- /api/qbo/verify (EDC: 7 invoices, €4,938.55 + £2,709.75). deleted_at takes the
-- time the row was last touched, which is when it was tombstoned.
UPDATE "invoices" SET "deleted_at" = "updated_at"
WHERE "deleted_at" IS NULL AND "payment_status" = 'Written Off' AND "qbo_id" IS NOT NULL;
