-- ============================================================================
-- Sage Intacct Integration — Database Migration
-- Run this once against your production PostgreSQL database.
-- All statements are idempotent (IF NOT EXISTS / IF NOT EXISTS guards).
-- ============================================================================

-- ── Add Sage Intacct ID to existing tables ───────────────────────────────────

ALTER TABLE customers     ADD COLUMN IF NOT EXISTS sage_intacct_id VARCHAR(64);
ALTER TABLE invoices      ADD COLUMN IF NOT EXISTS sage_intacct_id VARCHAR(64);
ALTER TABLE invoices      ADD COLUMN IF NOT EXISTS sage_intacct_balance REAL;
ALTER TABLE invoices      ADD COLUMN IF NOT EXISTS sage_intacct_customer_id VARCHAR(64);
ALTER TABLE invoices      ADD COLUMN IF NOT EXISTS sage_intacct_synced_at TIMESTAMP;
ALTER TABLE ap_suppliers  ADD COLUMN IF NOT EXISTS sage_intacct_id VARCHAR(64);
ALTER TABLE ap_bills      ADD COLUMN IF NOT EXISTS sage_intacct_id VARCHAR(64);

-- ── Unique index: one Sage invoice per org (prevents re-sync duplicates) ─────

CREATE UNIQUE INDEX IF NOT EXISTS invoices_org_sage_id_unique
  ON invoices (org_id, sage_intacct_id)
  WHERE sage_intacct_id IS NOT NULL;

-- ── Unique index: one Sage bill per org ──────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS ap_bills_org_sage_unique
  ON ap_bills (org_id, sage_intacct_id)
  WHERE sage_intacct_id IS NOT NULL;

-- ── Sage Intacct Credentials ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sage_intacct_credentials (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID         NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id       UUID         NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  company_id    VARCHAR(128) NOT NULL,   -- Sage Company ID (used in XML auth)
  sage_user_id  VARCHAR(128) NOT NULL,   -- Sage web services user login
  password      TEXT         NOT NULL,   -- AES-256-GCM encrypted user password
  entity_id     VARCHAR(64),             -- optional multi-entity location ID
  company_name  VARCHAR(255),            -- display name fetched from Sage on connect
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Only one credential row per org
CREATE UNIQUE INDEX IF NOT EXISTS sage_intacct_credentials_org_unique
  ON sage_intacct_credentials (org_id);

-- ── Sage Sync Log ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sage_sync_log (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID        REFERENCES organisations(id) ON DELETE CASCADE,
  user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  synced_at         TIMESTAMP   NOT NULL DEFAULT NOW(),
  status            VARCHAR(16) NOT NULL DEFAULT 'success',  -- 'success' | 'error'
  customers_created INTEGER     DEFAULT 0,
  invoices_created  INTEGER     DEFAULT 0,
  invoices_updated  INTEGER     DEFAULT 0,
  invoices_closed   INTEGER     DEFAULT 0,
  credits_created   INTEGER     DEFAULT 0,
  suppliers_created INTEGER     DEFAULT 0,
  bills_created     INTEGER     DEFAULT 0,
  bills_updated     INTEGER     DEFAULT 0,
  error_message     TEXT,
  duration_ms       INTEGER
);

-- Index for fast per-org history lookups
CREATE INDEX IF NOT EXISTS sage_sync_log_org_synced_idx
  ON sage_sync_log (org_id, synced_at DESC);
