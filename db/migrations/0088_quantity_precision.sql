-- Quantities gain two decimal places of storage.
--
-- Display was raised to 5 decimals, but EVERY quantity column was numeric(_,4),
-- so a 5th decimal could never be stored — entering 10.12345 kg silently became
-- 10.1235 on write. Against the instruction to "keep all decimal places in the
-- database", that is data loss, not a display limit.
--
-- WIDENING ONLY, AND STRICTLY NON-LOSSY. Precision goes up by 2 alongside scale:
--
--     numeric(18,4) -> numeric(20,6)      14 integer digits either way
--     numeric(14,4) -> numeric(16,6)      10 integer digits either way
--
-- Raising scale WITHOUT raising precision would have cost two integer digits
-- (numeric(18,4) holds 14 of them, numeric(18,6) only 12), and any value above
-- 10^12 would have failed the ALTER. Adding 2 to both keeps the integer range
-- exactly as it was, so no existing row can be rejected.
--
-- Scale 6 rather than 5: it matches unit_cost / exchange_rate, which are already
-- numeric(_,6), and leaves headroom for UoM conversions that produce repeating
-- decimals. Display stays at 5 per the instruction — the 6th is for arithmetic,
-- not for reading.
--
-- COST: changing a numeric column's scale rewrites the table (ACCESS EXCLUSIVE
-- lock for the duration). Columns are grouped ONE ALTER PER TABLE so each table
-- is rewritten once rather than once per column, and these tables hold
-- operational inventory rows rather than years of history. Nothing here drops,
-- narrows or deletes anything.
--
-- The column list is generated from db/schema.ts, so it cannot drift from the
-- Drizzle definitions it mirrors.

-- ap_items: min_oh_qty, on_hand_qty
ALTER TABLE "ap_items"
  ALTER COLUMN "min_oh_qty" TYPE numeric(16, 6),
  ALTER COLUMN "on_hand_qty" TYPE numeric(20, 6);
--> statement-breakpoint

-- inventory_lots: orig_qty, remaining_qty
ALTER TABLE "inventory_lots"
  ALTER COLUMN "orig_qty" TYPE numeric(20, 6),
  ALTER COLUMN "remaining_qty" TYPE numeric(20, 6);
--> statement-breakpoint

-- inventory_lot_locations: qty
ALTER TABLE "inventory_lot_locations"
  ALTER COLUMN "qty" TYPE numeric(20, 6);
--> statement-breakpoint

-- inventory_movements: qty
ALTER TABLE "inventory_movements"
  ALTER COLUMN "qty" TYPE numeric(20, 6);
--> statement-breakpoint

-- stock_transfer_lines: qty
ALTER TABLE "stock_transfer_lines"
  ALTER COLUMN "qty" TYPE numeric(20, 6);
--> statement-breakpoint

-- bom_lines: qty, output_pack_qty
ALTER TABLE "bom_lines"
  ALTER COLUMN "qty" TYPE numeric(20, 6),
  ALTER COLUMN "output_pack_qty" TYPE numeric(16, 6);
--> statement-breakpoint

-- production_runs: qty_to_produce
ALTER TABLE "production_runs"
  ALTER COLUMN "qty_to_produce" TYPE numeric(20, 6);
--> statement-breakpoint

-- production_consumptions: qty
ALTER TABLE "production_consumptions"
  ALTER COLUMN "qty" TYPE numeric(20, 6);
--> statement-breakpoint

-- manufacturing_orders: qty
ALTER TABLE "manufacturing_orders"
  ALTER COLUMN "qty" TYPE numeric(20, 6);
--> statement-breakpoint

-- mo_outputs: qty
ALTER TABLE "mo_outputs"
  ALTER COLUMN "qty" TYPE numeric(20, 6);
--> statement-breakpoint

-- production_outputs: qty_packs, qty_base
ALTER TABLE "production_outputs"
  ALTER COLUMN "qty_packs" TYPE numeric(20, 6),
  ALTER COLUMN "qty_base" TYPE numeric(20, 6);
--> statement-breakpoint

-- trade_document_lines: qty, ordered_base_qty, received_qty, billed_qty
ALTER TABLE "trade_document_lines"
  ALTER COLUMN "qty" TYPE numeric(16, 6),
  ALTER COLUMN "ordered_base_qty" TYPE numeric(20, 6),
  ALTER COLUMN "received_qty" TYPE numeric(20, 6),
  ALTER COLUMN "billed_qty" TYPE numeric(20, 6);
--> statement-breakpoint

-- goods_receipt_lines: qty_base, billed_qty
ALTER TABLE "goods_receipt_lines"
  ALTER COLUMN "qty_base" TYPE numeric(20, 6),
  ALTER COLUMN "billed_qty" TYPE numeric(20, 6);
--> statement-breakpoint

-- job_work_orders: sent_qty, received_qty, wastage_qty
ALTER TABLE "job_work_orders"
  ALTER COLUMN "sent_qty" TYPE numeric(20, 6),
  ALTER COLUMN "received_qty" TYPE numeric(20, 6),
  ALTER COLUMN "wastage_qty" TYPE numeric(20, 6);
--> statement-breakpoint

-- job_work_receipts: received_qty, material_qty_consumed
ALTER TABLE "job_work_receipts"
  ALTER COLUMN "received_qty" TYPE numeric(20, 6),
  ALTER COLUMN "material_qty_consumed" TYPE numeric(20, 6);
--> statement-breakpoint

-- shipment_lines: qty_base, invoiced_qty
ALTER TABLE "shipment_lines"
  ALTER COLUMN "qty_base" TYPE numeric(20, 6),
  ALTER COLUMN "invoiced_qty" TYPE numeric(20, 6);
