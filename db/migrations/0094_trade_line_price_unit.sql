-- A purchase-order line can be priced per a DIFFERENT unit than it is ordered
-- in: 5 cartons at 2.00 per metre. `rate` stays what it has always been — the
-- price per ORDER unit (1,200.00 per carton here), so amount = qty × rate and
-- every reader downstream (receiving, bill from PO, reports) is unchanged. The
-- four new columns keep what the buyer actually entered, so a reopened order
-- still reads "2.00 per metre" rather than a figure they never typed.
ALTER TABLE "trade_document_lines"
	ADD COLUMN IF NOT EXISTS "price_level" varchar(12),
	ADD COLUMN IF NOT EXISTS "price_uom" varchar(16),
	ADD COLUMN IF NOT EXISTS "units_per_price_unit" numeric(18,6),
	ADD COLUMN IF NOT EXISTS "price_input" numeric(18,6);
--> statement-breakpoint
-- The rate was numeric(14,4). A per-order-unit rate derived from a per-metre
-- price needs the same 6 decimals every other unit cost has (numeric(18,6));
-- at 4 it is rounded before it is stored. Widened on both precision and scale,
-- so the integer range grows and no existing row can be rejected.
ALTER TABLE "trade_document_lines" ALTER COLUMN "rate" TYPE numeric(18,6);
