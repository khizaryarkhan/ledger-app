-- Receipt-matched Bill rework (2026-10-25): transaction_links gains a nullable
-- qty column, used only by the receipt_bill relation. journal_lines has no
-- quantity column at all (the GL is pure debit/credit), so this is the one
-- place a Bill-from-receipt's per-line billed qty survives for the new
-- matching-table UI and for safely editing a receipt-matched Bill in place.
-- Every existing row gets NULL; no other relation is affected.
ALTER TABLE "transaction_links" ADD COLUMN IF NOT EXISTS "qty" numeric(18, 6);
