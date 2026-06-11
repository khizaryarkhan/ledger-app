-- =====================================================================
-- Security hardening migration — run on Neon (psql or the Neon SQL editor)
-- Safe to run more than once: every statement is idempotent (IF NOT EXISTS).
-- Read the "PRE-CHECK" notes before the two UNIQUE indexes in section 3.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Rate limiting (required to activate lib/rate-limit.ts)
--    Until this table exists the limiter fails open (no throttling).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limits (
  key        text        PRIMARY KEY,
  count      integer     NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_expires_idx ON rate_limits (expires_at);


-- ---------------------------------------------------------------------
-- 2. Performance indexes for hot tenant-scoped query paths.
--    Pure performance — safe, non-blocking on Neon for these sizes.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS invoices_org_created_idx        ON invoices       (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS invoices_org_customer_idx       ON invoices       (org_id, customer_id);
CREATE INDEX IF NOT EXISTS invoices_org_project_idx        ON invoices       (org_id, project_id);
CREATE INDEX IF NOT EXISTS communications_org_invoice_idx  ON communications (org_id, invoice_id);
CREATE INDEX IF NOT EXISTS communications_org_customer_idx ON communications (org_id, customer_id);
CREATE INDEX IF NOT EXISTS customers_org_status_idx        ON customers      (org_id, status);
CREATE INDEX IF NOT EXISTS email_templates_org_stage_idx   ON email_templates(org_id, collection_stage);
CREATE INDEX IF NOT EXISTS audit_events_org_occurred_idx   ON audit_events   (org_id, occurred_at DESC);


-- ---------------------------------------------------------------------
-- 3. Tenant-scoped uniqueness.
--
--    NOTE: These are DATA-QUALITY constraints, NOT security requirements.
--    Tenant isolation is enforced by org_id scoping on every query, not by
--    these uniques. invoice_number is treated as display-only in the schema
--    (duplicates are legitimate: multiple accounting sources, credit memos,
--    re-issued invoices) — so 3a/3b are LEFT COMMENTED OUT. The non-unique
--    performance indexes in section 2 already cover the lookup paths.
--
--    Only enable 3a/3b if you have confirmed your data should be unique AND
--    deduplicated it. Inspection + dedup helpers are at the bottom of this file.
-- ---------------------------------------------------------------------

-- 3a. (OPTIONAL) Invoice number unique per org — enable only after dedup.
-- ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_invoice_number_key; -- drop any legacy GLOBAL unique
-- CREATE UNIQUE INDEX IF NOT EXISTS invoices_org_number_unique
--   ON invoices (org_id, invoice_number);

-- 3b. (OPTIONAL) Contact email unique per customer per org — enable only after dedup.
-- CREATE UNIQUE INDEX IF NOT EXISTS contacts_org_customer_email_unique
--   ON contacts (org_id, customer_id, email);

-- 3c. One email connection per org (Gmail / Microsoft). These SHOULD be unique
--     — the app already upserts by org. If a CREATE below fails, run the matching
--     dedup in section 6 first, then re-run.
--     PRE-CHECK — must return 0 rows each:
--       SELECT org_id, COUNT(*) FROM microsoft_tokens GROUP BY org_id HAVING COUNT(*) > 1;
--       SELECT org_id, COUNT(*) FROM gmail_tokens     GROUP BY org_id HAVING COUNT(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS microsoft_tokens_org_unique
  ON microsoft_tokens (org_id);
CREATE UNIQUE INDEX IF NOT EXISTS gmail_tokens_org_unique
  ON gmail_tokens (org_id);


-- ---------------------------------------------------------------------
-- 4. reminder_schedules — add the missing tenant column.
--    The table is currently unused by the app, but it has no org_id at all.
--    Scope it now so it's safe if/when it's wired up. Backfills from the
--    linked invoice, then enforces NOT NULL.
-- ---------------------------------------------------------------------
ALTER TABLE reminder_schedules ADD COLUMN IF NOT EXISTS org_id uuid;

UPDATE reminder_schedules rs
   SET org_id = i.org_id
  FROM invoices i
 WHERE rs.invoice_id = i.id
   AND rs.org_id IS NULL;

-- Only enforce NOT NULL once every row is backfilled (no orphans).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM reminder_schedules WHERE org_id IS NULL) THEN
    ALTER TABLE reminder_schedules ALTER COLUMN org_id SET NOT NULL;
    BEGIN
      ALTER TABLE reminder_schedules
        ADD CONSTRAINT reminder_schedules_org_fk
        FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS reminder_schedules_org_idx ON reminder_schedules (org_id);


-- ---------------------------------------------------------------------
-- 5. (OPTIONAL) Prune stale rate-limit rows. Run anytime / on a schedule.
-- ---------------------------------------------------------------------
-- DELETE FROM rate_limits WHERE expires_at < now() - interval '1 day';


-- ---------------------------------------------------------------------
-- 6. (OPTIONAL) Inspection + dedup helpers — only needed if you choose to
--    enable the uniques in 3a/3b, or if 3c failed on duplicate tokens.
--    Always run the SELECT first and eyeball the rows before any DELETE.
-- ---------------------------------------------------------------------

-- 6a. INSPECT invoice-number duplicates (judge legit vs accidental):
-- SELECT org_id, invoice_number, COUNT(*) AS copies,
--        array_agg(DISTINCT txn_type) AS types, array_agg(id) AS ids
--   FROM invoices GROUP BY org_id, invoice_number HAVING COUNT(*) > 1
--   ORDER BY copies DESC;

-- 6b. INSPECT contact-email duplicates within a customer:
-- SELECT org_id, customer_id, lower(email) AS email, COUNT(*) AS copies,
--        array_agg(id) AS ids, array_agg(type) AS types
--   FROM contacts GROUP BY org_id, customer_id, lower(email) HAVING COUNT(*) > 1
--   ORDER BY copies DESC;

-- 6c. CONTACT dedup — keep the most recently created row per (org, customer,
--     email), delete the older copies. REVIEW 6b output first. Re-point any
--     FK references if needed before deleting. Then you can enable 3b.
-- WITH ranked AS (
--   SELECT id, row_number() OVER (
--            PARTITION BY org_id, customer_id, lower(email)
--            ORDER BY created_at DESC, id
--          ) AS rn
--   FROM contacts
-- )
-- DELETE FROM contacts WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 6d. EMAIL-TOKEN dedup (only if 3c failed) — keep the newest token per org:
-- WITH ranked AS (
--   SELECT id, row_number() OVER (PARTITION BY org_id ORDER BY updated_at DESC, created_at DESC) AS rn
--   FROM microsoft_tokens
-- )
-- DELETE FROM microsoft_tokens WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
-- WITH ranked AS (
--   SELECT id, row_number() OVER (PARTITION BY org_id ORDER BY updated_at DESC, created_at DESC) AS rn
--   FROM gmail_tokens
-- )
-- DELETE FROM gmail_tokens WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
