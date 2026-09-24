-- Manufacturing orders: the MO keeps its own copy of the materials it needs,
-- and production allocates specific lot quantities to it while it is in
-- progress. No accounting entry until the MO is completed; an allocation only
-- makes that stock unavailable to any other issue. See
-- lib/inventory/mo-allocations.ts.
CREATE TABLE IF NOT EXISTS "mo_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
	"mo_id" uuid NOT NULL REFERENCES "manufacturing_orders"("id") ON DELETE cascade,
	"item_id" uuid NOT NULL,
	"kind" varchar(12) NOT NULL,
	"planned_qty" numeric(20,6) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mo_materials_mo_idx" ON "mo_materials" ("mo_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lot_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
	"mo_id" uuid NOT NULL REFERENCES "manufacturing_orders"("id") ON DELETE cascade,
	"item_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL REFERENCES "inventory_lots"("id") ON DELETE cascade,
	"qty" numeric(20,6) NOT NULL,
	"suggested" boolean DEFAULT false NOT NULL,
	"allocated_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lot_allocations_mo_lot_unique" ON "lot_allocations" ("mo_id", "lot_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lot_allocations_lot_idx" ON "lot_allocations" ("lot_id");
