-- EDI foundation, expected deliveries (docs/prd-edi.md Phase 0 item 6). ADDITIVE: three new tables.
--
-- An expected delivery is what a supplier SAYS is on its way: from an advance ship notice (X12 856 / DESADV) or
-- typed by hand. It is a claim, never stock: nothing posts until a person counts the goods and the receipt posts
-- through postGoodsReceipt. Receiving pre-fills from it, and the pallet SSCCs scanned at the dock are matched
-- against the ones it announced.
--
-- "Received" is NOT stored: a delivery is received while goods_receipt_id points at a receipt. Voiding that receipt
-- deletes its row, the FK sets the link null, and the delivery is expected again by construction. Only a
-- cancellation is stored (status).
CREATE TABLE IF NOT EXISTS "expected_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "supplier_id" uuid REFERENCES "parties"("id") ON DELETE set null,
  "po_id" uuid REFERENCES "trade_documents"("id") ON DELETE set null,
  "source" varchar(8) DEFAULT 'manual' NOT NULL,
  "reference" varchar(64),
  "ship_date" date,
  "expected_date" date,
  "carrier" varchar(64),
  "tracking_no" varchar(64),
  "status" varchar(12) DEFAULT 'open' NOT NULL,
  "goods_receipt_id" uuid REFERENCES "goods_receipts"("id") ON DELETE set null,
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expected_deliveries_org_po_idx" ON "expected_deliveries" ("org_id", "po_id");
--> statement-breakpoint
-- A supplier's ASN / delivery note number names one delivery: unique per supplier (case-insensitive), ignoring
-- cancelled ones so a cancelled notice can be re-sent under the same number.
CREATE UNIQUE INDEX IF NOT EXISTS "expected_deliveries_ref_uq" ON "expected_deliveries" ("org_id", "supplier_id", upper("reference")) WHERE "reference" IS NOT NULL AND "status" <> 'cancelled';
--> statement-breakpoint
-- A pallet or carton the supplier announced, by SSCC. parent_sscc = the pallet a carton is on (one level).
CREATE TABLE IF NOT EXISTS "expected_delivery_packages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "expected_delivery_id" uuid NOT NULL REFERENCES "expected_deliveries"("id") ON DELETE cascade,
  "sscc" varchar(18) NOT NULL,
  "pack_type" varchar(32),
  "parent_sscc" varchar(18)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "expected_delivery_packages_uq" ON "expected_delivery_packages" ("expected_delivery_id", "sscc");
--> statement-breakpoint
-- What the supplier says is coming: an item (against a PO line when the delivery names a PO), a quantity in the
-- item's base unit, the supplier's batch and dates, and optionally the SSCC it is packed in.
CREATE TABLE IF NOT EXISTS "expected_delivery_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "expected_delivery_id" uuid NOT NULL REFERENCES "expected_deliveries"("id") ON DELETE cascade,
  "line_no" integer NOT NULL,
  "po_line_id" uuid REFERENCES "trade_document_lines"("id") ON DELETE set null,
  "item_id" uuid NOT NULL REFERENCES "ap_items"("id") ON DELETE restrict,
  "qty_base" numeric(20,6) NOT NULL,
  "sscc" varchar(18),
  "supplier_batch_no" varchar(64),
  "production_date" date,
  "best_before_date" date,
  "expiry_date" date
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expected_delivery_lines_delivery_idx" ON "expected_delivery_lines" ("expected_delivery_id");
