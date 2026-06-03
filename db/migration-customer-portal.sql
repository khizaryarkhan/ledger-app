-- =============================================================================
-- Migration: Customer Response Portal
-- Tokenised customer self-service portal for promise dates + disputes.
-- Run this in your Neon SQL console. Safe to run multiple times (IF NOT EXISTS).
-- =============================================================================

-- 1. Portal tokens — one token per emailed request, single-use
CREATE TABLE IF NOT EXISTS customer_portal_tokens (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  customer_id    UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token          VARCHAR(80) NOT NULL UNIQUE,
  invoice_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,
  status         VARCHAR(16) NOT NULL DEFAULT 'Active',  -- Active | Completed | Expired
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at     TIMESTAMP NOT NULL,
  last_viewed_at TIMESTAMP,
  completed_at   TIMESTAMP,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS portal_tokens_token_idx ON customer_portal_tokens (token);
CREATE INDEX IF NOT EXISTS portal_tokens_org_customer_idx ON customer_portal_tokens (org_id, customer_id);

-- 2. Promise-to-pay events (supports partial amounts + multiple sources)
CREATE TABLE IF NOT EXISTS invoice_promises (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  invoice_id   UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  customer_id  UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  promise_date VARCHAR(16) NOT NULL,
  amount       REAL,                              -- NULL = full balance
  source       VARCHAR(24) NOT NULL,              -- Customer Portal | Rep | Accountant
  entered_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  note         TEXT,
  status       VARCHAR(16) NOT NULL DEFAULT 'Active', -- Active | Met | Broken | Superseded
  token_id     UUID REFERENCES customer_portal_tokens(id) ON DELETE SET NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS invoice_promises_invoice_idx ON invoice_promises (invoice_id);
CREATE INDEX IF NOT EXISTS invoice_promises_org_status_idx ON invoice_promises (org_id, status);

-- 3. Dispute events
CREATE TABLE IF NOT EXISTS invoice_disputes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  invoice_id   UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  customer_id  UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  category     VARCHAR(32) NOT NULL,              -- Wrong Amount | Already Paid | Goods/Service | Duplicate | Other
  reason       TEXT,
  source       VARCHAR(24) NOT NULL,              -- Customer Portal | Rep | Accountant
  raised_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  status       VARCHAR(16) NOT NULL DEFAULT 'Open', -- Open | Under Review | Resolved | Rejected
  resolution   TEXT,
  resolved_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at  TIMESTAMP,
  token_id     UUID REFERENCES customer_portal_tokens(id) ON DELETE SET NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS invoice_disputes_invoice_idx ON invoice_disputes (invoice_id);
CREATE INDEX IF NOT EXISTS invoice_disputes_org_status_idx ON invoice_disputes (org_id, status);

-- 4. Cached derived state on invoices (for fast list filtering)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS promise_amount      REAL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS promise_source      VARCHAR(24);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS has_open_dispute    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS automations_paused  BOOLEAN NOT NULL DEFAULT FALSE;
