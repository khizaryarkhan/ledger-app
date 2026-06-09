-- Xero integration schema migration
-- Run once against the production database.

-- Add xeroId column to customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS xero_id VARCHAR(64);

-- Add xeroId column to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS xero_id VARCHAR(64);

-- Add Xero columns to invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_id VARCHAR(64);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_balance REAL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_customer_id VARCHAR(64);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_synced_at TIMESTAMP;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS xero_tenant_id VARCHAR(64);

-- Unique constraint: one xeroId per org on invoices (mirrors QBO constraint)
CREATE UNIQUE INDEX IF NOT EXISTS invoices_org_xero_id_unique
  ON invoices (org_id, xero_id)
  WHERE xero_id IS NOT NULL;

-- Xero sync log
CREATE TABLE IF NOT EXISTS xero_sync_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID REFERENCES organisations(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  synced_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  status            VARCHAR(16) NOT NULL DEFAULT 'success',
  customers_created INTEGER DEFAULT 0,
  invoices_created  INTEGER DEFAULT 0,
  invoices_updated  INTEGER DEFAULT 0,
  invoices_closed   INTEGER DEFAULT 0,
  credits_created   INTEGER DEFAULT 0,
  error_message     TEXT,
  duration_ms       INTEGER
);

-- Xero webhook events
CREATE TABLE IF NOT EXISTS xero_webhook_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  tenant_id     VARCHAR(64) NOT NULL,
  org_id        UUID REFERENCES organisations(id) ON DELETE SET NULL,
  status        VARCHAR(32) NOT NULL DEFAULT 'received',
  entity_count  INTEGER NOT NULL DEFAULT 0,
  entities      JSONB,
  error_message TEXT,
  processing_ms INTEGER
);

-- Xero tokens (one per org)
CREATE TABLE IF NOT EXISTS xero_tokens (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id                   UUID REFERENCES organisations(id) ON DELETE CASCADE,
  tenant_id                VARCHAR(64) NOT NULL,
  tenant_name              VARCHAR(255),
  access_token             TEXT NOT NULL,
  refresh_token            TEXT NOT NULL,
  access_token_expires_at  TIMESTAMP NOT NULL,
  refresh_token_expires_at TIMESTAMP NOT NULL,
  created_at               TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMP NOT NULL DEFAULT NOW()
);
