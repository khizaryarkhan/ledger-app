-- A supplier's price is quoted AT A PACKAGING LEVEL, and in the SUPPLIER's
-- currency.
--
-- PRICE BASIS. Vendors price per bottle, per bag, per carton — not always per
-- their base unit. unit_price (0089) holds price per ONE supplier UoM, and the
-- form made the buyer do the division themselves: a 30-litre bottle at 300 had
-- to be typed as 10/litre. Now the price is recorded exactly as quoted
-- (quoted_price) at the level it was quoted for (price_basis: unit | inner |
-- outer), and every other level — including ordering by the litre on a PO — is
-- derived from that one figure (lib/inventory/order-options.ts).
--
-- quoted_price is kept, not just converted into unit_price, because converting
-- loses it: 100 per 3-litre bottle is 33.333333 per litre at numeric(18,6),
-- which multiplies back to 99.999999 per bottle — a price nobody quoted.
-- unit_price stays, derived on every save, for readers that want the per-unit
-- figure.
ALTER TABLE "item_supplier_skus"
	ADD COLUMN IF NOT EXISTS "price_basis" varchar(12) DEFAULT 'unit' NOT NULL,
	ADD COLUMN IF NOT EXISTS "quoted_price" numeric(18,6);
--> statement-breakpoint
-- Existing prices were all entered per supplier unit.
UPDATE "item_supplier_skus" SET "quoted_price" = "unit_price", "price_basis" = 'unit'
WHERE "unit_price" IS NOT NULL AND "quoted_price" IS NULL;
--> statement-breakpoint
-- CURRENCY comes from the supplier. It was a per-link choice, which let one
-- supplier's links be priced in different currencies while every document for
-- that supplier must be in the supplier's own (postDocument enforces it). The
-- link now carries the supplier's currency; '' on a supplier means "not set
-- yet" (multi-currency orgs lock it from the first document), stored as NULL.
UPDATE "item_supplier_skus" s SET "currency" = NULLIF(p."currency", '')
FROM "parties" p
WHERE p."id" = s."supplier_id" AND p."org_id" = s."org_id"
	AND s."currency" IS DISTINCT FROM NULLIF(p."currency", '');
