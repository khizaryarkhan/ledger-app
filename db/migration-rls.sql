-- =====================================================================
-- Row-Level Security (RLS) — second-wall tenant isolation.
-- Run on Neon. SAFE-BY-CONSTRUCTION: enabling this does NOT change app
-- behaviour, because every policy has a NULL-escape:
--
--     current_setting('app.current_org_id', true) IS NULL  OR  org_id = <that>::uuid
--
-- The app today never sets app.current_org_id, so the GUC is NULL and every
-- policy passes -> queries behave exactly as before. RLS only starts FILTERING
-- once you (a) connect as a non-owner role AND (b) set the GUC per request
-- (see "ENFORCEMENT" at the bottom). Until then this is inert scaffolding that
-- already protects against any *non-app* connection that sets the GUC.
--
-- Idempotent: re-running drops+recreates each policy. We ENABLE (not FORCE)
-- RLS, so the table-owner role the app connects with is unaffected even if a
-- GUC is set — a deliberate extra safety margin during rollout.
-- =====================================================================

-- 1. Tenant tables keyed by org_id — apply the standard org-isolation policy.
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'customers','contacts','projects','invoices','payments','payment_applications',
    'refund_receipts','deposits','journal_entry_ar_lines','communications','tasks',
    'email_templates','reminder_schedules','reps','regions','customer_portal_tokens',
    'invoice_promises','invoice_disputes','audit_events','qbo_sync_log',
    'qbo_webhook_events','xero_webhook_events','qbo_tokens','xero_tokens',
    'gmail_tokens','microsoft_tokens','org_smtp_settings','user_organisations',
    'subscriptions'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    -- Skip tables that don't exist in this database (defensive).
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE NOTICE 'skipping missing table %', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY org_isolation ON public.%I
      USING (
        current_setting('app.current_org_id', true) IS NULL
        OR org_id = current_setting('app.current_org_id', true)::uuid
      )
      WITH CHECK (
        current_setting('app.current_org_id', true) IS NULL
        OR org_id = current_setting('app.current_org_id', true)::uuid
      )
    $f$, t);
  END LOOP;
END $$;

-- 2. organisations — the tenant root is keyed by id, not org_id.
ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON organisations;
CREATE POLICY org_isolation ON organisations
  USING (
    current_setting('app.current_org_id', true) IS NULL
    OR id = current_setting('app.current_org_id', true)::uuid
  );

-- NOTE: users / sessions / pending_registrations / rate_limits are intentionally
-- NOT given org policies — they are cross-org / auth-plane tables (login looks up
-- users by email with no org context). Leaving them unrestricted keeps auth working.


-- =====================================================================
-- ENFORCEMENT (manual, deliberate — do NOT run blindly in production)
-- =====================================================================
-- The scaffolding above is inert until you make the app subject to RLS AND
-- set the org GUC per request. Recommended staged rollout:
--
-- 1. Create a restricted role that does NOT own the tables (so it cannot
--    bypass RLS), and grant it DML:
--      CREATE ROLE app_rls LOGIN PASSWORD '<strong>';
--      GRANT USAGE ON SCHEMA public TO app_rls;
--      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rls;
--      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rls;
--      ALTER DEFAULT PRIVILEGES IN SCHEMA public
--        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rls;
--
-- 2. In the app, set the GUC at the start of every request's DB work, e.g.
--    wrap queries in a transaction that first runs:
--      SET LOCAL app.current_org_id = '<orgId from requireOrg()>';
--    (With @neondatabase/serverless this means using the Pool/transaction API
--     so SET LOCAL and the query share one transaction. lib/api.ts already
--     resolves the orgId — thread it into a db wrapper.)
--
-- 3. Point DATABASE_URL at app_rls, deploy to a PREVIEW first, and verify reads
--    AND writes work for a normal tenant user. Only then promote to production.
--
-- 4. (Optional, strongest) Once verified, remove the NULL-escape from each
--    policy so a missing GUC fails closed instead of open:
--      ... USING ( org_id = current_setting('app.current_org_id', true)::uuid )
--    Do this LAST and only after every query path sets the GUC.
-- =====================================================================
