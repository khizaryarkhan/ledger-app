-- Hybrid billing: manual subscription management support
-- Run this on your Neon database.

-- Make stripe_customer_id nullable (manual orgs have no Stripe customer)
ALTER TABLE subscriptions ALTER COLUMN stripe_customer_id DROP NOT NULL;

-- Add hybrid billing columns
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS source varchar(16) NOT NULL DEFAULT 'stripe';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS manual_expires_at timestamptz;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS manual_payment_status varchar(32);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS manual_invoice_ref varchar(128);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS manual_notes text;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS managed_by_admin_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS managed_at timestamptz;

-- All existing rows are Stripe-managed
UPDATE subscriptions SET source = 'stripe' WHERE source IS NULL OR source = '';
