-- Chart of Accounts mapping for inventory (Phase 2, R-01..R-04).
-- Posting resolves a ROLE through the item's posting group instead of reading
-- an account off the item or guessing one by QBO subtype. See
-- lib/accounting/account-roles.ts for the vocabulary.
ALTER TABLE "accounts"
	ADD COLUMN IF NOT EXISTS "is_system_default" boolean DEFAULT false NOT NULL,
	ADD COLUMN IF NOT EXISTS "default_role" varchar(32),
	ADD COLUMN IF NOT EXISTS "is_header" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_posting_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
	"name" varchar(128) NOT NULL,
	"group_type" varchar(16) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"template_version" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_posting_groups_name_unique" ON "inventory_posting_groups" ("org_id", lower(trim("name")));
--> statement-breakpoint
-- One DEFAULT group per type per org. Provisioning has no transaction to hold
-- (neon-http), so two first-postings racing are settled by this index, not a lock.
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_posting_groups_default_unique" ON "inventory_posting_groups" ("org_id", "group_type") WHERE "is_default";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "posting_group_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
	"group_id" uuid NOT NULL REFERENCES "inventory_posting_groups"("id") ON DELETE cascade,
	"role" varchar(32) NOT NULL,
	"account_id" uuid NOT NULL REFERENCES "accounts"("id"),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "posting_group_accounts_role_unique" ON "posting_group_accounts" ("group_id", "role");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "posting_group_accounts_account_idx" ON "posting_group_accounts" ("account_id");
--> statement-breakpoint
ALTER TABLE "ap_items" ADD COLUMN IF NOT EXISTS "posting_group_id" uuid REFERENCES "inventory_posting_groups"("id");
--> statement-breakpoint
-- A tracked item's asset / COGS field holding the OLD single system account
-- (Inventory Asset / Cost of Goods Sold) was never a choice — the item form
-- defaulted it. Left in place it would read as a deliberate override and keep
-- every item posting to the one catch-all account the groups exist to split.
-- Clearing it makes the item inherit its group. Only native items can match:
-- synced items hold provider ids, never a local account uuid.
UPDATE "ap_items" i SET "asset_account_id" = NULL
WHERE i."product_type" IN ('FinishedProduct','StockItem','RawMaterial','WorkInProgress')
  AND i."asset_account_id" IN (SELECT a."id"::text FROM "accounts" a WHERE a."org_id" = i."org_id" AND a."is_system" AND a."subtype" = 'Inventory');
--> statement-breakpoint
UPDATE "ap_items" i SET "cogs_account_id" = NULL
WHERE i."product_type" IN ('FinishedProduct','StockItem','RawMaterial','WorkInProgress')
  AND i."cogs_account_id" IN (SELECT a."id"::text FROM "accounts" a WHERE a."org_id" = i."org_id" AND a."is_system" AND a."subtype" = 'SuppliesMaterialsCogs');
--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "inventory_template_version" integer;
