-- Phase 2 of supplier-scoped purchasing: the item↔supplier link becomes a real
-- purchasing info record, not just a packaging note.
--
-- item_supplier_skus already held the half that answers "when THIS vendor says
-- a bag, how many kg is that?" — supplier UoM, conversion factor, inner/outer
-- pack. It held nothing about the commercial terms, so a purchase line still
-- defaulted its rate from ap_items.unit_cost: ONE cost shared by every
-- supplier. Two vendors quoting 480/kg and 505/kg could not both be recorded,
-- and neither could a lead time or a minimum order.
--
-- Every mature system puts these on the vendor line rather than the item: SAP's
-- purchasing info record, Oracle's supplier-item attributes, NetSuite's item
-- vendor sublist, Odoo's product.supplierinfo. This migration closes that gap.
--
-- UNITS — unit_price is per ONE SUPPLIER UoM, the unit the vendor actually
-- quotes in, and so is min_order_qty. A purchase line's rate is per ORDER unit
-- and the order unit varies by pack level, so no single stored figure can serve
-- every level directly; lib/inventory/order-options.ts derives each level's
-- rate as unit_price * units_per_order_unit / base-units-per-supplier-unit.
-- Storing the vendor's own quoted number keeps the record readable next to
-- their price list, which is where it gets checked.

ALTER TABLE "item_supplier_skus"
	-- numeric(18,6) matches unit_cost / exchange_rate elsewhere. A supplier price
	-- divided down to a base unit (a 12,000 pallet over 500 kg) needs more than
	-- 2dp to survive the round trip, which is the same reason CLAUDE.md fixed the
	-- money display rule at up to 6 decimals.
	ADD COLUMN IF NOT EXISTS "unit_price" numeric(18,6),
	-- NULL = quoted in the org's home currency. Stored explicitly because a
	-- supplier's price list is in THEIR currency, and defaulting a rate across a
	-- currency boundary without saying so is how a PO ends up silently wrong.
	ADD COLUMN IF NOT EXISTS "currency" varchar(3),
	-- Calendar days from order to receipt. Drives the expected delivery date and,
	-- later, the supply-chain watchdog's lateness comparison.
	ADD COLUMN IF NOT EXISTS "lead_time_days" integer,
	-- Scale 6 for the same reason every quantity column is (migration 0088): a
	-- minimum the database cannot represent is a minimum that silently shifts.
	ADD COLUMN IF NOT EXISTS "min_order_qty" numeric(20,6),
	-- The default source for this item. Scoped per ITEM, not per supplier, so it
	-- answers both "which vendor do we buy this from" and, when one vendor has
	-- several pack configurations for the same item, "which one defaults".
	ADD COLUMN IF NOT EXISTS "is_preferred" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- At most one preferred link per item. A partial unique index rather than
-- application logic because two concurrent saves cannot both win here — the
-- same reason the default-location race in 0087 is closed by an index and not
-- by a lock (neon-http has no transactions to hold one in).
CREATE UNIQUE INDEX IF NOT EXISTS "item_supplier_skus_preferred_unique"
	ON "item_supplier_skus" ("org_id", "item_id") WHERE "is_preferred";
--> statement-breakpoint
-- Supplier-scoped reads are now the hot path for the purchase order form
-- (GET /api/inventory/supplier-skus?supplierId=), which the item_id index
-- cannot serve.
CREATE INDEX IF NOT EXISTS "item_supplier_skus_supplier_idx"
	ON "item_supplier_skus" ("org_id", "supplier_id");
--> statement-breakpoint
-- A link with no supplier cannot answer the only question it exists to answer,
-- and it slips past every supplier-scoped read. The API has refused to create
-- one since the previous commit; this removes any that predate that rule so the
-- NOT NULL below can be trusted. Safe because such a row is unusable by
-- definition — it can never be matched to a purchase order.
DELETE FROM "item_supplier_skus" WHERE "supplier_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "item_supplier_skus" ALTER COLUMN "supplier_id" SET NOT NULL;
--> statement-breakpoint
-- Every item that already has links gets one marked preferred — the oldest,
-- which is the one whoever set the item up reached for first. Without this no
-- item has a preferred source until someone edits it, and the price shown on a
-- purchase line would depend on row order. DISTINCT ON picks exactly one per
-- item, so the partial unique index above cannot be violated.
UPDATE "item_supplier_skus" SET "is_preferred" = true WHERE "id" IN (
	SELECT DISTINCT ON ("org_id", "item_id") "id" FROM "item_supplier_skus"
	ORDER BY "org_id", "item_id", "created_at"
);
--> statement-breakpoint
-- Sourcing policy, per item. `restricted` (the default) means this item is
-- bought from the suppliers it is linked to; `open` means any supplier may
-- supply it, and it is then ordered in its base UoM with no pack configuration
-- — because a pack configuration is a statement about one named vendor's
-- packaging, and there is no such vendor to name.
--
-- Deliberately a column on the ITEM rather than a flag on a link row: "anyone
-- can supply this" is a property of the item, and a link row asserting it would
-- have to carry a supplier_id it simultaneously claims not to have. This is
-- also where SAP puts it — the source list requirement indicator lives on the
-- material master, not on the source list.
--
-- Default `restricted` for tracked items; Service and Non-Inventory are set
-- `open` below, since pack-configuring "Consulting" is meaningless.
ALTER TABLE "ap_items"
	ADD COLUMN IF NOT EXISTS "sourcing_policy" varchar(16) DEFAULT 'restricted' NOT NULL;
--> statement-breakpoint
UPDATE "ap_items" SET "sourcing_policy" = 'open'
	WHERE "product_type" IN ('Service', 'NonInventory');
