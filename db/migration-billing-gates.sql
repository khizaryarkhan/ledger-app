-- Billing gates: index on subscriptions.org_id for fast per-org access checks
-- Run this on your Neon database.

CREATE INDEX IF NOT EXISTS idx_subscriptions_org_id ON subscriptions(org_id);
