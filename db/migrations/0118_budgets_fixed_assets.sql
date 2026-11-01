-- Budgets and fixed assets (2026-11-01). Additive only.
CREATE TABLE IF NOT EXISTS "budgets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "name" varchar(120) NOT NULL,
  "year" integer NOT NULL,
  "status" varchar(16) DEFAULT 'active' NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budgets_org_year_idx" ON "budgets" ("org_id", "year");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "budget_id" uuid NOT NULL REFERENCES "budgets"("id") ON DELETE CASCADE,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "month" integer NOT NULL,
  "amount" numeric(14,2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_lines_budget_idx" ON "budget_lines" ("budget_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "budget_lines_budget_account_month_uq" ON "budget_lines" ("budget_id", "account_id", "month");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fixed_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "code" varchar(32),
  "name" varchar(160) NOT NULL,
  "purchase_date" varchar(16) NOT NULL,
  "cost" numeric(14,2) NOT NULL,
  "salvage_value" numeric(14,2) DEFAULT '0' NOT NULL,
  "useful_life_months" integer NOT NULL,
  "asset_account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "accum_dep_account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "depreciation_expense_account_id" uuid NOT NULL REFERENCES "accounts"("id"),
  "status" varchar(16) DEFAULT 'active' NOT NULL,
  "disposed_date" varchar(16),
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fixed_assets_org_status_idx" ON "fixed_assets" ("org_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fixed_asset_depreciation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "asset_id" uuid NOT NULL REFERENCES "fixed_assets"("id") ON DELETE CASCADE,
  "period" varchar(7) NOT NULL,
  "amount" numeric(14,2) NOT NULL,
  "journal_entry_id" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fixed_asset_dep_asset_period_uq" ON "fixed_asset_depreciation" ("asset_id", "period");
