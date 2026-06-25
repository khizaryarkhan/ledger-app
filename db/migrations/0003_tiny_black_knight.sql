-- Phase 4: account_id becomes required (one company = one account).
-- SELF-HEALING: before flipping NOT NULL, back-stop any row the keyed backfill
-- could not link (no name/email, or created after the Sync button ran) with a
-- fallback crm_accounts row keyed on the entity id. Idempotent: only touches
-- rows still NULL, and inserts are ON CONFLICT DO NOTHING. This guarantees the
-- ALTER ... SET NOT NULL below can never fail on a stray NULL.

-- 1. Organisations (billing customers) ------------------------------------------
INSERT INTO "crm_accounts" ("name", "match_key", "organisation_id", "lifecycle_stage")
SELECT COALESCE(NULLIF(o."name", ''), 'Customer ' || o."id"::text), 'org:' || o."id"::text, o."id", 'customer'
FROM "organisations" o
WHERE o."account_id" IS NULL
ON CONFLICT ("match_key") DO NOTHING;--> statement-breakpoint

UPDATE "organisations" o SET "account_id" = a."id"
FROM "crm_accounts" a
WHERE o."account_id" IS NULL AND a."match_key" = 'org:' || o."id"::text;--> statement-breakpoint

-- 2. Leads (landing_page_requests) ----------------------------------------------
INSERT INTO "crm_accounts" ("name", "match_key", "billing_email", "country", "lifecycle_stage")
SELECT COALESCE(NULLIF(l."company_name", ''), NULLIF(l."full_name", ''), l."email", 'Lead ' || l."id"::text),
       'lead:' || l."id"::text, l."email", l."country", 'lead'
FROM "landing_page_requests" l
WHERE l."account_id" IS NULL
ON CONFLICT ("match_key") DO NOTHING;--> statement-breakpoint

UPDATE "landing_page_requests" l SET "account_id" = a."id"
FROM "crm_accounts" a
WHERE l."account_id" IS NULL AND a."match_key" = 'lead:' || l."id"::text;--> statement-breakpoint

-- 3. Opportunities — inherit from the linked lead, then org, else fallback -------
UPDATE "opportunities" op SET "account_id" = l."account_id"
FROM "landing_page_requests" l
WHERE op."account_id" IS NULL AND op."lead_id" = l."id" AND l."account_id" IS NOT NULL;--> statement-breakpoint

UPDATE "opportunities" op SET "account_id" = o."account_id"
FROM "organisations" o
WHERE op."account_id" IS NULL AND op."org_id" = o."id" AND o."account_id" IS NOT NULL;--> statement-breakpoint

INSERT INTO "crm_accounts" ("name", "match_key", "lifecycle_stage")
SELECT COALESCE(NULLIF(op."title", ''), 'Deal ' || op."id"::text), 'opp:' || op."id"::text, 'qualified'
FROM "opportunities" op
WHERE op."account_id" IS NULL
ON CONFLICT ("match_key") DO NOTHING;--> statement-breakpoint

UPDATE "opportunities" op SET "account_id" = a."id"
FROM "crm_accounts" a
WHERE op."account_id" IS NULL AND a."match_key" = 'opp:' || op."id"::text;--> statement-breakpoint

-- 4. Now the data is complete — make the link required. -------------------------
ALTER TABLE "landing_page_requests" ALTER COLUMN "account_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ALTER COLUMN "account_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "organisations" ALTER COLUMN "account_id" SET NOT NULL;
