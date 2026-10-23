-- Manual per-line close for Purchase Order lines (2026-10-23). Lets a buyer
-- stop expecting the remainder of a line a supplier will never fully deliver,
-- without inventing a fake received quantity. See db/schema.ts's
-- trade_document_lines for the full design note.
ALTER TABLE "trade_document_lines" ADD COLUMN IF NOT EXISTS "closed" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "trade_document_lines" ADD COLUMN IF NOT EXISTS "close_reason" text;
--> statement-breakpoint
ALTER TABLE "trade_document_lines" ADD COLUMN IF NOT EXISTS "closed_at" timestamp;
