-- BOM Builder phase 2, slice 1: ordered substitutes and allowed supplier SKUs per
-- ingredient, plus the item facts they lean on (weight per unit, allergens).
-- ALL ADDITIVE and NOT ENFORCED YET: manufacturing orders do not read these tables
-- until slice 2, so nothing about how an order allocates or consumes changes.
-- Keyed by (bom_id, primary_item_id): a BOM lists each ingredient once (0134), and
-- saving a BOM replaces its bom_lines, so rows must not point at a bom_lines id.
ALTER TABLE "ap_items" ADD COLUMN IF NOT EXISTS "weight_per_unit_kg" numeric(18,6), ADD COLUMN IF NOT EXISTS "allergens" text[];
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bom_line_substitutes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "bom_id" uuid NOT NULL REFERENCES "boms"("id") ON DELETE CASCADE,
  "primary_item_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "qty" numeric(20,6) NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bom_line_substitutes_unique" ON "bom_line_substitutes" ("bom_id", "primary_item_id", "item_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bom_line_allowed_skus" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "bom_id" uuid NOT NULL REFERENCES "boms"("id") ON DELETE CASCADE,
  "primary_item_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "supplier_sku_id" uuid NOT NULL REFERENCES "item_supplier_skus"("id") ON DELETE CASCADE,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bom_line_allowed_skus_unique" ON "bom_line_allowed_skus" ("bom_id", "primary_item_id", "item_id", "supplier_sku_id");
