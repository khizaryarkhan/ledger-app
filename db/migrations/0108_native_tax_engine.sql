-- Native tax engine (sales-document refactor, Phase 3, 2026-10-21). Entirely
-- new tables, additive — ap_tax_rates (the QBO/Xero sync mirror) is untouched.
-- See db/schema.ts's "NATIVE TAX ENGINE" section for the full design note.
CREATE TABLE IF NOT EXISTS "tax_agencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
	"name" varchar(128) NOT NULL,
	"country" varchar(8),
	"liability_account_id" uuid REFERENCES "accounts"("id"),
	"filing_frequency" varchar(32),
	"status" varchar(16) DEFAULT 'Active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tax_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
	"agency_id" uuid NOT NULL REFERENCES "tax_agencies"("id") ON DELETE restrict,
	"name" varchar(128) NOT NULL,
	"rate" numeric(7, 4) NOT NULL,
	"sales_account_id" uuid REFERENCES "accounts"("id"),
	"purchase_account_id" uuid REFERENCES "accounts"("id"),
	"effective_from" date NOT NULL,
	"effective_to" date,
	"status" varchar(16) DEFAULT 'Active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tax_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
	"name" varchar(128) NOT NULL,
	"treatment" varchar(24) DEFAULT 'standard' NOT NULL,
	"compound" boolean DEFAULT false NOT NULL,
	"status" varchar(16) DEFAULT 'Active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tax_code_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
	"tax_code_id" uuid NOT NULL REFERENCES "tax_codes"("id") ON DELETE cascade,
	"component_id" uuid NOT NULL REFERENCES "tax_components"("id") ON DELETE restrict,
	"sequence" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tax_code_components_unique" ON "tax_code_components" ("tax_code_id","component_id");
