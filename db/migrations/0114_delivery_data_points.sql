-- Delivery data points (2026-10-28): the facts supplier / customer delivery
-- performance (OTIF) reporting needs, none of which existed before.
-- Every column is nullable or defaulted, so no existing row changes meaning.
--
-- Supplier register: a default lead time, used when the item's own supplier
-- link carries none (link lead time wins — it is the more specific fact).
-- On `parties` itself: ap_suppliers is a view over it and does not need to see
-- this column, the lead-time resolver reads parties directly.
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "lead_time_days" integer;
--> statement-breakpoint
-- PO / SO header: the counterparty's own reference (supplier's order
-- confirmation no. on a PO, the customer's PO no. on an SO), when it was sent,
-- when the counterparty confirmed it, and the confirmed delivery date.
ALTER TABLE "trade_documents" ADD COLUMN IF NOT EXISTS "party_ref" varchar(64);
--> statement-breakpoint
ALTER TABLE "trade_documents" ADD COLUMN IF NOT EXISTS "sent_at" timestamp;
--> statement-breakpoint
ALTER TABLE "trade_documents" ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "trade_documents" ADD COLUMN IF NOT EXISTS "confirmed_by" uuid;
--> statement-breakpoint
ALTER TABLE "trade_documents" ADD COLUMN IF NOT EXISTS "promised_date" varchar(16);
--> statement-breakpoint
-- PO / SO line: when we asked for it, when the counterparty promised it, the
-- FIRST promise (kept so a slipped promise is still measured against what was
-- originally committed) and how many times the promise moved.
ALTER TABLE "trade_document_lines" ADD COLUMN IF NOT EXISTS "requested_date" varchar(16);
--> statement-breakpoint
ALTER TABLE "trade_document_lines" ADD COLUMN IF NOT EXISTS "promised_date" varchar(16);
--> statement-breakpoint
ALTER TABLE "trade_document_lines" ADD COLUMN IF NOT EXISTS "original_promised_date" varchar(16);
--> statement-breakpoint
ALTER TABLE "trade_document_lines" ADD COLUMN IF NOT EXISTS "promise_revisions" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Goods receipt: the supplier's delivery note / ASN number, the paper the
-- goods arrived with — the third leg of a three-way match.
ALTER TABLE "goods_receipts" ADD COLUMN IF NOT EXISTS "delivery_note_no" varchar(64);
--> statement-breakpoint
-- Shipment: who carried it, the tracking number, and proof-of-delivery date.
ALTER TABLE "sales_shipments" ADD COLUMN IF NOT EXISTS "carrier" varchar(64);
--> statement-breakpoint
ALTER TABLE "sales_shipments" ADD COLUMN IF NOT EXISTS "tracking_no" varchar(128);
--> statement-breakpoint
ALTER TABLE "sales_shipments" ADD COLUMN IF NOT EXISTS "delivered_date" date;
