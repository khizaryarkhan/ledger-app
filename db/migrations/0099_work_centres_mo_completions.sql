-- Labour & overhead, yield, and partial completion for manufacturing orders.
-- Rates live on WORK CENTRES; the time a recipe takes lives on the BOM's
-- OPERATIONS; an MO copies both (with the rates as at planning), plus its
-- expected yield and each pack's content, so a later edit never re-costs an
-- order in flight. Each completion is its own production run.
CREATE TABLE IF NOT EXISTS "work_centres" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
	"code" varchar(32),
	"name" varchar(128) NOT NULL,
	"labour_rate" numeric(18,6) DEFAULT '0' NOT NULL,
	"overhead_rate" numeric(18,6) DEFAULT '0' NOT NULL,
	"status" varchar(16) DEFAULT 'Active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_centres_name_unique" ON "work_centres" ("org_id", lower(trim("name")));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bom_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
	"bom_id" uuid NOT NULL REFERENCES "boms"("id") ON DELETE cascade,
	"work_centre_id" uuid NOT NULL REFERENCES "work_centres"("id"),
	"hours_per_batch" numeric(16,6) NOT NULL,
	"description" varchar(255),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bom_operations_bom_idx" ON "bom_operations" ("bom_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mo_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
	"mo_id" uuid NOT NULL REFERENCES "manufacturing_orders"("id") ON DELETE cascade,
	"work_centre_id" uuid,
	"name" varchar(128) NOT NULL,
	"planned_hours" numeric(16,6) NOT NULL,
	"labour_rate" numeric(18,6) DEFAULT '0' NOT NULL,
	"overhead_rate" numeric(18,6) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mo_operations_mo_idx" ON "mo_operations" ("mo_id");
--> statement-breakpoint
ALTER TABLE "mo_materials" ADD COLUMN IF NOT EXISTS "for_sku_id" uuid;
--> statement-breakpoint
ALTER TABLE "mo_outputs"
	ADD COLUMN IF NOT EXISTS "unit_content" numeric(20,6),
	ADD COLUMN IF NOT EXISTS "completed_qty" numeric(20,6) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "manufacturing_orders" ADD COLUMN IF NOT EXISTS "exp_yield" numeric(9,4);
--> statement-breakpoint
ALTER TABLE "production_runs"
	ADD COLUMN IF NOT EXISTS "mo_id" uuid,
	ADD COLUMN IF NOT EXISTS "good_qty" numeric(20,6),
	ADD COLUMN IF NOT EXISTS "rejected_qty" numeric(20,6),
	ADD COLUMN IF NOT EXISTS "labour_cost" numeric(18,4) DEFAULT '0' NOT NULL,
	ADD COLUMN IF NOT EXISTS "overhead_cost" numeric(18,4) DEFAULT '0' NOT NULL,
	ADD COLUMN IF NOT EXISTS "scrap_cost" numeric(18,4) DEFAULT '0' NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_runs_mo_idx" ON "production_runs" ("mo_id");
