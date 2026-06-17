-- Migration 0006: Approver Portal & Bill Comments
-- Adds external approver token system + per-bill comment/chat log

-- 1. New columns on ap_bills
ALTER TABLE ap_bills
  ADD COLUMN IF NOT EXISTS approver_email    VARCHAR(256),
  ADD COLUMN IF NOT EXISTS last_approval_sent_at TIMESTAMPTZ;

-- 2. ap_approval_tokens (external approver portal links)
CREATE TABLE IF NOT EXISTS ap_approval_tokens (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  bill_id         UUID        NOT NULL REFERENCES ap_bills(id) ON DELETE CASCADE,
  token           TEXT        NOT NULL UNIQUE,
  approver_email  TEXT        NOT NULL,
  approver_name   TEXT,
  sent_by_user_id UUID        REFERENCES users(id) ON DELETE SET NULL,
  status          VARCHAR(32) NOT NULL DEFAULT 'Pending',
  decision        TEXT,
  submitted_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ap_approval_tokens_bill ON ap_approval_tokens(bill_id);

-- 3. ap_bill_comments (chat log per bill)
CREATE TABLE IF NOT EXISTS ap_bill_comments (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  bill_id      UUID        NOT NULL REFERENCES ap_bills(id) ON DELETE CASCADE,
  body         TEXT        NOT NULL,
  author_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
  author_name  TEXT        NOT NULL,
  channel      VARCHAR(32) NOT NULL DEFAULT 'internal',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ap_bill_comments_bill ON ap_bill_comments(bill_id);
