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
-- 3. Tenant-scoped uniqueness (defence against cross-org collisions).
--
--    PRE-CHECK FIRST. These CREATE UNIQUE INDEX statements will FAIL if
--    duplicates already exist. Run the two SELECTs below; if either returns
--    rows, resolve those duplicates before creating the matching index.
--    (Duplicates are most likely from multi-source syncs — investigate, do
--     not blindly delete.)
-- ---------------------------------------------------------------------

-- 3a. Invoice number unique per org (replaces any legacy GLOBAL unique).
--     PRE-CHECK — must return 0 rows:
--     SELECT org_id, invoice_number, COUNT(*) FROM invoices
--       GROUP BY org_id, invoice_number HAVING COUNT(*) > 1;
-- Drop a stray global unique if one exists from an old schema:
-- ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_invoice_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_org_number_unique
  ON invoices (org_id, invoice_number);

-- 3b. Contact email unique per customer per org.
--     PRE-CHECK — must return 0 rows:
--     SELECT org_id, customer_id, lower(email), COUNT(*) FROM contacts
--       GROUP BY org_id, customer_id, lower(email) HAVING COUNT(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_org_customer_email_unique
  ON contacts (org_id, customer_id, email);

-- 3c. One email connection per org (Gmail / Microsoft).
--     Gmail likely already has this; add Microsoft for parity.
--     PRE-CHECK — must return 0 rows each:
--     SELECT org_id, COUNT(*) FROM microsoft_tokens GROUP BY org_id HAVING COUNT(*) > 1;
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
