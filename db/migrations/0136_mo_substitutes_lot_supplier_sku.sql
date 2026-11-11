-- BOM Builder phase 2, slice 2: manufacturing orders honour an ingredient's ordered
-- substitutes and supplier-SKU limit. ALL ADDITIVE; existing orders and lots are
-- untouched (an order planned before this has no substitutes or limits to honour).
--
-- inventory_lots.supplier_sku_id: which supplier SKU a lot was bought as. NULL for lots
-- that never had one (no-PO receipts, counts, opening stock, production); under a SKU
-- limit a NULL lot is REFUSED, a decision recorded in lib/inventory/allocation.ts.
ALTER TABLE "inventory_lots" ADD COLUMN IF NOT EXISTS "supplier_sku_id" uuid REFERENCES "item_supplier_skus"("id") ON DELETE SET NULL;
--> statement-breakpoint
-- for_item_id: the MATERIAL a substituted lot stands in for (NULL = the item itself).
-- Completion costs the consumption as that material, and the order shows what was used.
ALTER TABLE "lot_allocations" ADD COLUMN IF NOT EXISTS "for_item_id" uuid;
--> statement-breakpoint
ALTER TABLE "production_consumptions" ADD COLUMN IF NOT EXISTS "for_item_id" uuid;
--> statement-breakpoint
-- The MO's own copy of the BOM's substitutes and limits, taken when the order is planned,
-- like mo_materials: a later BOM edit never changes an order already planned.
CREATE TABLE IF NOT EXISTS "mo_material_substitutes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "mo_id" uuid NOT NULL REFERENCES "manufacturing_orders"("id") ON DELETE CASCADE,
  "primary_item_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "planned_qty" numeric(20,6) NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mo_material_substitutes_unique" ON "mo_material_substitutes" ("mo_id", "primary_item_id", "item_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mo_material_allowed_skus" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "mo_id" uuid NOT NULL REFERENCES "manufacturing_orders"("id") ON DELETE CASCADE,
  "primary_item_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "supplier_sku_id" uuid NOT NULL REFERENCES "item_supplier_skus"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mo_material_allowed_skus_unique" ON "mo_material_allowed_skus" ("mo_id", "primary_item_id", "item_id", "supplier_sku_id");
