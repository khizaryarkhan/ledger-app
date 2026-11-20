-- EDI foundation, SSCC (docs/prd-edi.md Phase 0 item 5). ADDITIVE: three org columns and three new tables.
--
-- An SSCC (GS1 Serial Shipping Container Code, AI 00) identifies ONE logistic unit: a pallet or a carton. 18
-- digits = extension digit (1) + the org's GS1 Company Prefix + a serial reference + check digit. The ship notice
-- (X12 856 / DESADV) lists each pallet and carton by SSCC with what is on it, and the customer scans the label.
--
-- organisations: the GS1 Company Prefix (assigned by the org's GS1 member office; we never invent one), the
-- extension digit (0-9, the org's free choice), and the next serial reference. The counter only ever goes UP, so an
-- SSCC is never handed out twice (GS1: not re-used within 12 months; here, never).
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "gs1_company_prefix" varchar(12), ADD COLUMN IF NOT EXISTS "sscc_extension_digit" smallint DEFAULT 0 NOT NULL, ADD COLUMN IF NOT EXISTS "sscc_next_serial" bigint DEFAULT 1 NOT NULL;
--> statement-breakpoint
-- A packed unit on a shipment: a pallet, or a carton (optionally on a pallet: parent_id). One level of nesting.
CREATE TABLE IF NOT EXISTS "shipment_packages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "shipment_id" uuid NOT NULL REFERENCES "sales_shipments"("id") ON DELETE cascade,
  "parent_id" uuid REFERENCES "shipment_packages"("id") ON DELETE cascade,
  "sscc" varchar(18) NOT NULL,
  "pack_type" varchar(32) NOT NULL,
  "gross_weight_kg" numeric(14,3),
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- An SSCC names one unit, ever: unique per org.
CREATE UNIQUE INDEX IF NOT EXISTS "shipment_packages_sscc_uq" ON "shipment_packages" ("org_id", "sscc");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_packages_shipment_idx" ON "shipment_packages" ("shipment_id");
--> statement-breakpoint
-- What is in a package: a quantity (item base unit) of one shipment line.
CREATE TABLE IF NOT EXISTS "shipment_package_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "package_id" uuid NOT NULL REFERENCES "shipment_packages"("id") ON DELETE cascade,
  "shipment_line_id" uuid NOT NULL REFERENCES "shipment_lines"("id") ON DELETE cascade,
  "qty_base" numeric(20,6) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipment_package_lines_package_idx" ON "shipment_package_lines" ("package_id");
--> statement-breakpoint
-- SSCCs captured on a goods receipt (scanned or typed from the supplier's pallet labels).
CREATE TABLE IF NOT EXISTS "goods_receipt_packages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "receipt_id" uuid NOT NULL REFERENCES "goods_receipts"("id") ON DELETE cascade,
  "sscc" varchar(18) NOT NULL,
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "goods_receipt_packages_uq" ON "goods_receipt_packages" ("receipt_id", "sscc");
