-- ===================================================================
-- RESET QBO SYNCED DATA FOR ALL ORGANISATIONS
-- ===================================================================
--
-- WHAT THIS DOES
--   Deletes every transactional row that came from QBO so the next sync
--   rebuilds them cleanly. Use this when payment_applications, JE state,
--   or invoice paid status has drifted from QBO and you want a known-good
--   starting point.
--
-- WHAT IT PRESERVES
--   - qbo_tokens         (your OAuth connections — keep them)
--   - customers          (preserves rep/region/owner/notes you assigned)
--   - projects           (same — your classification stays)
--   - contacts           (preserves manual edits + auto-reminder flags)
--   - users, reps, regions, organisations, audit_events, communications,
--     tasks, automations, email_templates, smart_views, org_smtp_settings
--
-- HOW TO RUN
--   Paste in Neon SQL editor (or psql) and execute as a single transaction.
--   The next QBO sync will re-fetch invoices, payments, applications, JEs,
--   deposits, refund receipts.
--
-- OPTIONAL: full wipe (also clear customers, contacts, projects)
--   Uncomment the section labelled "FULL WIPE" at the bottom. WARNING: this
--   drops your rep/region assignments and any manual notes — they'll be
--   reset to whatever QBO has.
-- ===================================================================

BEGIN;

-- Transactional data synced from QBO.
-- Order matters because of foreign keys (children first, parents last).

-- 1. Payment applications (FK → payments, invoices)
TRUNCATE TABLE payment_applications RESTART IDENTITY CASCADE;

-- 2. Payments
TRUNCATE TABLE payments RESTART IDENTITY CASCADE;

-- 3. Refund receipts (independent)
TRUNCATE TABLE refund_receipts RESTART IDENTITY CASCADE;

-- 4. Journal Entry AR lines
TRUNCATE TABLE journal_entry_ar_lines RESTART IDENTITY CASCADE;

-- 5. Deposits (AR-affecting lines only)
TRUNCATE TABLE deposits RESTART IDENTITY CASCADE;

-- 6. Invoices (includes credit memos via txn_type='CreditMemo')
TRUNCATE TABLE invoices RESTART IDENTITY CASCADE;

-- 7. QBO webhook delivery log (optional; speeds up new webhooks)
TRUNCATE TABLE qbo_webhook_events RESTART IDENTITY CASCADE;

-- 8. QBO sync log (optional; keep if you want sync history audit)
-- Comment the next line out to keep the audit trail.
TRUNCATE TABLE qbo_sync_log RESTART IDENTITY CASCADE;

-- ===================================================================
-- FULL WIPE (uncomment to also delete customers / projects / contacts)
-- ===================================================================
-- WARNING: this loses your rep / region / owner / notes / chase-by-project
-- settings. The next sync will recreate the customer rows from QBO with
-- defaults. Only do this if those local fields are also corrupted.
--
-- TRUNCATE TABLE contacts        RESTART IDENTITY CASCADE;
-- TRUNCATE TABLE projects        RESTART IDENTITY CASCADE;
-- TRUNCATE TABLE customers       RESTART IDENTITY CASCADE;

COMMIT;

-- ===================================================================
-- Verify
-- ===================================================================
-- After committing, run these to confirm the wipe is complete:
--   SELECT count(*) FROM invoices;               -- expect 0
--   SELECT count(*) FROM payments;               -- expect 0
--   SELECT count(*) FROM payment_applications;   -- expect 0
--   SELECT count(*) FROM journal_entry_ar_lines; -- expect 0
--   SELECT count(*) FROM deposits;               -- expect 0
--   SELECT count(*) FROM refund_receipts;        -- expect 0
--   SELECT count(*) FROM customers;              -- preserved
--   SELECT count(*) FROM qbo_tokens;             -- preserved
--
-- Then trigger a sync: Settings → Integrations → Sync from QuickBooks.
