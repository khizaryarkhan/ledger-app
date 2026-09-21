-- Phase 1 of the Supply Chain completion: stock becomes location-aware.
--
-- Until now inventory_lots and inventory_movements carried NO location at all —
-- `location_id` existed only on journal_lines and trade_document_lines, where it
-- is a GL reporting dimension, not a physical place. A business with a raw
-- material store, a WIP floor and a finished-goods warehouse could not say where
-- anything was.
--
-- DESIGN: the lot stays the COST LAYER and the identity (FIFO ordering, the
-- org-wide unique lot code, genealogy). Location is a physical OVERLAY on top of
-- it: inventory_lot_locations records where a lot's remaining quantity sits.
-- Splitting lots per location would have been the other option and was rejected
-- — it multiplies lot codes, breaks the org-wide unique lot number that lot
-- traceability depends on, and makes FIFO ordering ambiguous.
--
-- The invariant this creates, checked in lib/accounting/reconcile.ts:
--   inventory_lots.remaining_qty = SUM(inventory_lot_locations.qty) for that lot.

CREATE TABLE IF NOT EXISTS "stock_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"name" varchar(255) NOT NULL,
	-- Store | WIP | FinishedGoods | Transit | Quarantine.
	-- Quarantine exists now so the Phase 5 QC-on-receipt flow has somewhere to
	-- receive into without another migration.
	"type" varchar(24) DEFAULT 'Store' NOT NULL,
	-- Self-reference: a site today, a bin inside that site later. Present from
	-- the start so bin-level detail never needs a second structural migration.
	"parent_id" uuid,
	-- Optional GL override. NULL = stock here posts to the item's own asset
	-- account (today's behaviour for every org). Set it only when a location's
	-- stock must sit in a different balance-sheet account.
	"inventory_account_id" uuid,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" varchar(16) DEFAULT 'Active' NOT NULL,
	"address" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_parent_id_stock_locations_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."stock_locations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- A location code is how staff refer to a place on paper and on a screen; a
-- duplicate inside one org makes every picking instruction ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS "stock_locations_org_code_unique" ON "stock_locations" ("org_id", lower("code"));
--> statement-breakpoint

-- Exactly one default per org, enforced rather than trusted: the default is
-- what every existing posting path resolves to when a caller names no location,
-- so two of them would make that resolution non-deterministic.
CREATE UNIQUE INDEX IF NOT EXISTS "stock_locations_org_default_unique" ON "stock_locations" ("org_id") WHERE "is_default";
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "stock_locations_org_status_idx" ON "stock_locations" ("org_id", "status");
--> statement-breakpoint


-- Where a lot's remaining quantity physically sits. One row per (lot, location)
-- holding a positive quantity; a row is removed when it reaches zero, so the
-- table stays proportional to live stock rather than to history (history lives
-- in inventory_movements).
CREATE TABLE IF NOT EXISTS "inventory_lot_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "inventory_lot_locations" ADD CONSTRAINT "inventory_lot_locations_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- CASCADE on the lot: reverseInventoryByEntry deletes a receipt lot outright
-- when a document is voided, and its placement must go with it rather than
-- survive as an orphan that the reconciliation check would then report.
DO $$ BEGIN
 ALTER TABLE "inventory_lot_locations" ADD CONSTRAINT "inventory_lot_locations_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- RESTRICT, not cascade: deleting a location that still holds stock would
-- silently destroy the placement of real inventory. The application blocks the
-- delete with a readable message; this is the backstop.
DO $$ BEGIN
 ALTER TABLE "inventory_lot_locations" ADD CONSTRAINT "inventory_lot_locations_location_id_stock_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."stock_locations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_lot_locations_lot_location_unique" ON "inventory_lot_locations" ("lot_id", "location_id");
--> statement-breakpoint

-- "What is in this location?" — the Stock Status by location report and every
-- location-scoped issue plan run this.
CREATE INDEX IF NOT EXISTS "inventory_lot_locations_org_location_idx" ON "inventory_lot_locations" ("org_id", "location_id");
--> statement-breakpoint


-- A movement now records where stock came FROM and went TO. A receipt has only
-- `to`; an issue has only `from`; a transfer has both. Reversal reads these back
-- to restore quantity to the exact location it left.
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "from_location_id" uuid;
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "to_location_id" uuid;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_from_location_id_stock_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."stock_locations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_to_location_id_stock_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."stock_locations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint


-- ── Backfill ──────────────────────────────────────────────────────────────
-- Only orgs that actually hold stock get a location. Creating one for every
-- organisation would put a "Main Store" in the face of every Receivables-only
-- tenant — the same mistake as seeding the Suspense account into every chart of
-- accounts, which reached a paying client. Orgs that start using inventory later
-- get theirs on demand from ensureDefaultLocation() in lib/inventory/locations.ts.
INSERT INTO "stock_locations" ("org_id", "code", "name", "type", "is_default")
SELECT DISTINCT l."org_id", 'MAIN', 'Main Store', 'Store', true
  FROM "inventory_lots" l
 WHERE NOT EXISTS (
   SELECT 1 FROM "stock_locations" s WHERE s."org_id" = l."org_id"
 );
--> statement-breakpoint

-- Every lot that still holds stock is placed in its org's default location.
-- Depleted lots (remaining_qty = 0) are deliberately left with no row: the
-- invariant treats "no rows" as zero, so an empty lot is already consistent and
-- a zero row would only be noise.
INSERT INTO "inventory_lot_locations" ("org_id", "lot_id", "location_id", "qty")
SELECT l."org_id", l."id", s."id", l."remaining_qty"
  FROM "inventory_lots" l
  JOIN "stock_locations" s ON s."org_id" = l."org_id" AND s."is_default"
 WHERE l."remaining_qty" > 0
   AND NOT EXISTS (
     SELECT 1 FROM "inventory_lot_locations" ll WHERE ll."lot_id" = l."id"
   );
--> statement-breakpoint

-- NOTE: historical inventory_movements rows are deliberately NOT back-filled.
-- They predate locations and cannot be attributed to one honestly. A NULL on an
-- old movement means "recorded before locations existed"; stamping the default
-- location onto them would make the movement history assert a physical fact
-- that was never observed.


-- ── Documents record WHERE stock moved ────────────────────────────────────
-- Placement is not a property of the lot alone; it is a decision someone made
-- when they recorded the document. Storing it on the header means the receipt,
-- shipment, build or dispatch can be re-read later and still say where the
-- stock went, instead of that being inferable only from the movement rows.
--
-- All nullable: every one of these documents already exists in production
-- without a location, and a NULL resolves to the org default at posting time.

ALTER TABLE "goods_receipts"   ADD COLUMN IF NOT EXISTS "location_id" uuid;
--> statement-breakpoint
ALTER TABLE "sales_shipments"  ADD COLUMN IF NOT EXISTS "location_id" uuid;
--> statement-breakpoint
-- A build consumes from one place and delivers output to another — commonly a
-- component store and a finished-goods area, which is the whole reason the two
-- are separate columns rather than one.
ALTER TABLE "production_runs"  ADD COLUMN IF NOT EXISTS "consume_location_id" uuid;
--> statement-breakpoint
ALTER TABLE "production_runs"  ADD COLUMN IF NOT EXISTS "output_location_id" uuid;
--> statement-breakpoint
-- Job work: material leaves a store on dispatch and the transformed item comes
-- back to (usually) a different one.
ALTER TABLE "job_work_orders"  ADD COLUMN IF NOT EXISTS "dispatch_location_id" uuid;
--> statement-breakpoint
ALTER TABLE "job_work_orders"  ADD COLUMN IF NOT EXISTS "receive_location_id" uuid;
--> statement-breakpoint

-- SET NULL rather than RESTRICT on these: a location that has been emptied and
-- deleted should not make a years-old posted receipt undeletable. The stock is
-- already gone; only the historical label is lost, and inventory_movements
-- still carries what happened.
DO $$ BEGIN
 ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_location_id_stock_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."stock_locations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_shipments" ADD CONSTRAINT "sales_shipments_location_id_stock_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."stock_locations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_consume_location_id_stock_locations_id_fk" FOREIGN KEY ("consume_location_id") REFERENCES "public"."stock_locations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_output_location_id_stock_locations_id_fk" FOREIGN KEY ("output_location_id") REFERENCES "public"."stock_locations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_work_orders" ADD CONSTRAINT "job_work_orders_dispatch_location_id_stock_locations_id_fk" FOREIGN KEY ("dispatch_location_id") REFERENCES "public"."stock_locations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_work_orders" ADD CONSTRAINT "job_work_orders_receive_location_id_stock_locations_id_fk" FOREIGN KEY ("receive_location_id") REFERENCES "public"."stock_locations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;


-- ── Stock transfer document ───────────────────────────────────────────────
-- Moving stock between locations is a decision someone made on a date, for a
-- reason, and it needs to be listable, printable and reversible — so it is a
-- real document rather than a bare pair of movement rows.
--
-- A transfer changes WHERE stock is, never WHAT IT COST: no lot is created, no
-- lot balance changes, and the FIFO cost layer keeps its identity. The GL is
-- touched only when the two locations map to different inventory accounts.
CREATE TABLE IF NOT EXISTS "stock_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"transfer_no" varchar(32),
	"transfer_date" date NOT NULL,
	"from_location_id" uuid NOT NULL,
	"to_location_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'Posted' NOT NULL,
	-- NULL when both locations post to the same inventory account, which is the
	-- ordinary case: nothing has changed in the books, so inventing a zero-value
	-- journal entry would add noise to the ledger for no information.
	"entry_id" uuid,
	"total_cost" numeric(18, 4) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "stock_transfer_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"transfer_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"sku_id" uuid,
	-- The exact cost layer moved. A transfer is specific-identification by
	-- nature: you pick up particular boxes and carry them, so the line records
	-- which lot actually moved rather than re-deriving it later.
	"lot_id" uuid,
	"qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(18, 6) DEFAULT '0' NOT NULL,
	"amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_location_id_stock_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."stock_locations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_location_id_stock_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."stock_locations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_transfer_id_stock_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."stock_transfers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "stock_transfers_org_date_idx" ON "stock_transfers" ("org_id", "transfer_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_transfer_lines_transfer_idx" ON "stock_transfer_lines" ("transfer_id");
