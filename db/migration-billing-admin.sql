-- =========================================================================
-- BILLING ADMIN PANEL MIGRATION
-- Extends subscriptions table + adds cancellation_requests,
-- landing_page_requests, and billing_audit_logs tables.
-- Run once against the production database.
-- =========================================================================

-- ── Extend subscriptions ─────────────────────────────────────────────────
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS current_period_start  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS trial_end             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_email         VARCHAR(255),
  ADD COLUMN IF NOT EXISTS plan_name             VARCHAR(128),
  ADD COLUMN IF NOT EXISTS plan_amount           INTEGER,
  ADD COLUMN IF NOT EXISTS plan_interval         VARCHAR(16),
  ADD COLUMN IF NOT EXISTS plan_currency         VARCHAR(8),
  ADD COLUMN IF NOT EXISTS last_payment_status   VARCHAR(32),
  ADD COLUMN IF NOT EXISTS last_payment_amount   INTEGER,
  ADD COLUMN IF NOT EXISTS last_payment_date     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_method_brand  VARCHAR(32),
  ADD COLUMN IF NOT EXISTS payment_method_last4  VARCHAR(4),
  ADD COLUMN IF NOT EXISTS stripe_updated_at     TIMESTAMPTZ;

-- ── Add platform_admin role to users (no schema change needed — role is text) ──

-- ── Cancellation requests ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cancellation_requests (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id            UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  stripe_customer_id         TEXT,
  stripe_subscription_id     TEXT,
  requested_by_user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  requested_by_email         VARCHAR(255),
  reason                     TEXT,
  status                     VARCHAR(32) NOT NULL DEFAULT 'pending',
  requested_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at                TIMESTAMPTZ,
  reviewed_by_admin_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  admin_decision             VARCHAR(32),
  cancellation_effective_date TIMESTAMPTZ,
  internal_notes             TEXT,
  stripe_action_status       VARCHAR(32),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cancellation_requests_org_idx    ON cancellation_requests(organization_id);
CREATE INDEX IF NOT EXISTS cancellation_requests_status_idx ON cancellation_requests(status);

-- ── Landing page requests / leads ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS landing_page_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name           VARCHAR(255) NOT NULL,
  company_name        VARCHAR(255),
  email               VARCHAR(255) NOT NULL,
  phone               VARCHAR(64),
  company_size        VARCHAR(64),
  interested_service  VARCHAR(128),
  message             TEXT,
  source              VARCHAR(64) NOT NULL DEFAULT 'landing_page',
  status              VARCHAR(32) NOT NULL DEFAULT 'new',
  assigned_to_admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  admin_notes         TEXT,
  utm_source          VARCHAR(128),
  utm_medium          VARCHAR(128),
  utm_campaign        VARCHAR(128),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS landing_page_requests_status_idx ON landing_page_requests(status);
CREATE INDEX IF NOT EXISTS landing_page_requests_email_idx  ON landing_page_requests(email);

-- ── Billing audit logs ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_audit_logs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          UUID REFERENCES organisations(id) ON DELETE SET NULL,
  cancellation_request_id  UUID REFERENCES cancellation_requests(id) ON DELETE SET NULL,
  actor_user_id            UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role               VARCHAR(32),
  action                   VARCHAR(64) NOT NULL,
  previous_status          VARCHAR(32),
  new_status               VARCHAR(32),
  stripe_event_id          VARCHAR(128),
  stripe_action_status     VARCHAR(32),
  metadata                 JSONB,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS billing_audit_logs_org_idx ON billing_audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS billing_audit_logs_action_idx ON billing_audit_logs(action);
