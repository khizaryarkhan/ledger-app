-- BOM batch size gets a unit the author chose (any unit measuring the same thing as the output
-- item's base unit). ADDITIVE and display-only: boms.batch_size stays in the item's BASE unit,
-- so manufacturing orders and costing read exactly what they read before. NULL = the base unit,
-- which is what every existing BOM means.
ALTER TABLE "boms" ADD COLUMN IF NOT EXISTS "batch_uom" varchar(16);
