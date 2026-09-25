-- Per-item "can be sold" / "can be purchased" (spec R-07) and a separate
-- default purchase tax. The flags are NULLABLE on purpose: null means "the
-- item kind's default" (lib/inventory/item-kinds.ts), so every existing item
-- keeps behaving exactly as it did and nothing needed back-filling. New items
-- are written with an explicit value.
ALTER TABLE "ap_items"
	ADD COLUMN IF NOT EXISTS "can_be_sold" boolean,
	ADD COLUMN IF NOT EXISTS "can_be_purchased" boolean,
	ADD COLUMN IF NOT EXISTS "purchase_tax_rate_id" varchar(64);
