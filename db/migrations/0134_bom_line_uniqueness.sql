-- A BOM lists each output pack, each ingredient and each packaging line ONCE.
-- Manufacturing-order planning keys outputs by SKU and sums ingredients by item,
-- so a duplicate silently overwrote (outputs) or merged (ingredients) with no
-- error. Checked read-only on dev and production before adding
-- (scripts/_scan_duplicate_bom_lines.ts): zero existing duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS "bom_lines_output_unique" ON "bom_lines" ("bom_id", COALESCE("sku_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "role" = 'output';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bom_lines_input_unique" ON "bom_lines" ("bom_id", "item_id") WHERE "role" = 'input';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bom_lines_pack_unique" ON "bom_lines" ("bom_id", "item_id", COALESCE("packaging_for_sku_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "role" = 'pack';
