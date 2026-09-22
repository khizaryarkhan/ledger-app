-- GS1 foundation: barcodes per packaging level, and the lot data a GS1-128
-- label carries. Groundwork for printing compliant labels and, later, filling
-- receiving in from a mobile-camera scan.
--
-- ITEM_IDENTIFIERS — one row per barcode. Its own table, not columns on the two
-- SKU tables, because the one question a scanner asks is "what is THIS code?",
-- and that has to be ONE indexed lookup across every level of every item —
-- not a search through seven columns in two tables.
--
-- Owner: a row belongs to a sales packaging SKU (item_sku_id), a supplier link
-- (supplier_sku_id), or — both NULL — the item's own base unit.
--
-- Pack level: unit | inner | addl_inner | outer, matching the levels the two
-- SKU tables already describe. (A pallet is a logistic unit identified by an
-- SSCC per shipment, not a trade item with a GTIN, so it is not a level here.)
--
-- scheme GTIN: stored normalised to 14 digits (lib/gs1.ts normaliseGtin), so
-- an EAN-13 and the same number scanned as GTIN-14 are one item. scheme OTHER:
-- any non-GS1 barcode (a supplier's own Code 128), stored as entered.
--
-- UNIQUENESS is deliberately per OWNER, not per org. A GTIN identifies the
-- manufacturer's trade item, not who sold it to us: the same yarn cone bought
-- from two distributors carries the same GTIN on both supplier links. What must
-- never happen is one code pointing at two different ITEMS — that is enforced
-- in lib/inventory/identifiers-server.ts, and a scan is disambiguated by the
-- supplier on the receipt.
CREATE TABLE IF NOT EXISTS "item_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
	"item_id" uuid NOT NULL REFERENCES "ap_items"("id") ON DELETE CASCADE,
	"item_sku_id" uuid REFERENCES "item_skus"("id") ON DELETE CASCADE,
	"supplier_sku_id" uuid REFERENCES "item_supplier_skus"("id") ON DELETE CASCADE,
	"scheme" varchar(8) DEFAULT 'GTIN' NOT NULL,
	"code" varchar(48) NOT NULL,
	"pack_level" varchar(16) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "item_identifiers_one_owner" CHECK (NOT ("item_sku_id" IS NOT NULL AND "supplier_sku_id" IS NOT NULL)),
	CONSTRAINT "item_identifiers_scheme" CHECK ("scheme" IN ('GTIN', 'OTHER')),
	CONSTRAINT "item_identifiers_level" CHECK ("pack_level" IN ('unit', 'inner', 'addl_inner', 'outer'))
);
--> statement-breakpoint
-- The scanner's lookup.
CREATE INDEX IF NOT EXISTS "item_identifiers_code_idx" ON "item_identifiers" ("org_id", "code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "item_identifiers_item_idx" ON "item_identifiers" ("org_id", "item_id");
--> statement-breakpoint
-- One code of each scheme per level per owner. An expression index because the
-- owner is whichever of the three ids is set.
CREATE UNIQUE INDEX IF NOT EXISTS "item_identifiers_owner_level_unique" ON "item_identifiers"
	("org_id", COALESCE("supplier_sku_id", "item_sku_id", "item_id"), "pack_level", "scheme");
--> statement-breakpoint
-- item_skus.upc was the only barcode field anywhere. Carry it across so nothing
-- a user typed is lost: a value that passes the GS1 check digit becomes a GTIN
-- at the SKU's consumer-unit level (inner); anything else is kept as OTHER. The
-- column itself stays for now, unread, and can be dropped once this has run.
INSERT INTO "item_identifiers" ("org_id", "item_id", "item_sku_id", "scheme", "code", "pack_level")
SELECT v."org_id", v."item_id", v."id",
	CASE WHEN v."valid" THEN 'GTIN' ELSE 'OTHER' END,
	CASE WHEN v."valid" THEN lpad(v."c", 14, '0') ELSE left(trim(v."raw"), 48) END,
	'inner'
FROM (
	SELECT u.*,
		(u."c" ~ '^[0-9]+$' AND length(u."c") IN (8, 12, 13, 14) AND
		 (10 - (
			SELECT sum(substr(u."c", length(u."c") - 1 - i, 1)::int * CASE WHEN i % 2 = 0 THEN 3 ELSE 1 END)
			FROM generate_series(0, length(u."c") - 2) AS i
		 ) % 10) % 10 = right(u."c", 1)::int
		) AS "valid"
	FROM (
		SELECT s."id", s."org_id", s."item_id", s."upc" AS "raw", regexp_replace(s."upc", '[[:space:]-]', '', 'g') AS "c"
		FROM "item_skus" s
		WHERE s."upc" IS NOT NULL AND trim(s."upc") <> ''
	) u
) v
WHERE NOT EXISTS (
	SELECT 1 FROM "item_identifiers" x
	WHERE x."item_sku_id" = v."id" AND x."pack_level" = 'inner'
);
--> statement-breakpoint
-- LOT DATA a GS1-128 label carries, beside the expiry lots already have (AI 17).
--
-- supplier_batch_no is AI (10) as the SUPPLIER printed it. It is NOT lot_no:
-- lot_no is our own identifier, unique across the org because traceability
-- depends on it, and until now the supplier's batch was typed straight into
-- it — so two suppliers who both print batch "2401" collided, and the second
-- receipt was refused. Scanning makes that routine. Kept apart: ours stays
-- unique, theirs is recorded exactly as printed, and a recall notice quoting
-- their batch can be traced through ours.
ALTER TABLE "inventory_lots"
	ADD COLUMN IF NOT EXISTS "supplier_batch_no" varchar(64),
	ADD COLUMN IF NOT EXISTS "production_date" date,
	ADD COLUMN IF NOT EXISTS "best_before_date" date;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_lots_supplier_batch_idx" ON "inventory_lots" ("org_id", "supplier_batch_no")
	WHERE "supplier_batch_no" IS NOT NULL;
