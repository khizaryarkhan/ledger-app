-- EDI foundation, part-number cross-references (docs/prd-edi.md Phase 0 item 2). ADDITIVE: a new table, and a copy of
-- the existing supplier_sku values into it. Nothing existing is altered or dropped.
--
-- A part number is a PARTNER's code for one of our items at one pack level: the supplier's number when we buy (X12 VP),
-- the customer's number when we sell (X12 BP on their inbound order). Unlike a barcode (item_identifiers, unique across
-- the org because a scan has no partner), a part number only means something with its partner, so it is unique per
-- partner, not per org: two suppliers may both call different things "A100".
CREATE TABLE IF NOT EXISTS "item_part_numbers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "item_id" uuid NOT NULL REFERENCES "ap_items"("id") ON DELETE cascade,
  "party_id" uuid NOT NULL REFERENCES "parties"("id") ON DELETE cascade,
  "side" varchar(8) NOT NULL,
  "supplier_sku_id" uuid REFERENCES "item_supplier_skus"("id") ON DELETE cascade,
  "item_sku_id" uuid REFERENCES "item_skus"("id") ON DELETE cascade,
  "pack_level" varchar(16) DEFAULT 'unit' NOT NULL,
  "code" varchar(48) NOT NULL,
  "code_key" varchar(48) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- One partner code means ONE thing. This is what lets an inbound order line resolve without guessing.
CREATE UNIQUE INDEX IF NOT EXISTS "item_part_numbers_partner_code_uq" ON "item_part_numbers" ("org_id", "party_id", "side", "code_key");
--> statement-breakpoint
-- A supplier link carries at most one part number per pack level.
CREATE UNIQUE INDEX IF NOT EXISTS "item_part_numbers_supplier_level_uq" ON "item_part_numbers" ("supplier_sku_id", "pack_level") WHERE "supplier_sku_id" IS NOT NULL;
--> statement-breakpoint
-- A customer has at most one part number for one of our items (or sales SKU) at one pack level.
CREATE UNIQUE INDEX IF NOT EXISTS "item_part_numbers_customer_level_uq" ON "item_part_numbers" ("org_id", "party_id", "item_id", COALESCE("item_sku_id", '00000000-0000-0000-0000-000000000000'::uuid), "pack_level") WHERE "side" = 'customer';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_part_numbers_item_idx" ON "item_part_numbers" ("org_id", "item_id");
--> statement-breakpoint
-- The old "Supplier's SKU" field held the supplier's code for the link: copy it as the link's unit-level part number.
-- Only where the supplier is a real party of the same org; a clash with the new unique index is skipped, not failed.
-- item_code_by_supplier is empty everywhere (checked on production and dev, 2026-11-20), so there is nothing to copy.
INSERT INTO "item_part_numbers" ("org_id", "item_id", "party_id", "side", "supplier_sku_id", "pack_level", "code", "code_key")
SELECT s."org_id", s."item_id", s."supplier_id", 'supplier', s."id", 'unit', left(trim(s."supplier_sku"), 48),
       left(upper(regexp_replace(trim(s."supplier_sku"), '\s+', ' ', 'g')), 48)
FROM "item_supplier_skus" s
JOIN "parties" p ON p."id" = s."supplier_id" AND p."org_id" = s."org_id"
WHERE s."supplier_sku" IS NOT NULL AND trim(s."supplier_sku") <> ''
ON CONFLICT DO NOTHING;
