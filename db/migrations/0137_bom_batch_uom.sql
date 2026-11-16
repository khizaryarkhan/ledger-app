-- BOM batch size gets a unit the author chose (any unit measuring the same thing as the output
-- item's base unit). ADDITIVE and display-only: boms.batch_size stays in the item's BASE unit,
-- so manufacturing orders and costing read exactly what they read before. NULL = the base unit,
-- which is what every existing BOM means.
ALTER TABLE "boms" ADD COLUMN IF NOT EXISTS "batch_uom" varchar(16);
--> statement-breakpoint
-- Widened by +2 on BOTH scale and precision (like 0088), so the integer range is unchanged and no existing row can be
-- rejected. A batch typed in a different unit converts to many decimals of the base unit; at scale 4 it was truncated.
ALTER TABLE "boms" ALTER COLUMN "batch_size" TYPE numeric(20,6);
