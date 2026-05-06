-- ============================================================
-- PER-ORG QBO + SMTP MIGRATION
-- Run in Neon SQL Editor AFTER migration-multitenant.sql
-- ============================================================

-- 1. Restructure qbo_tokens to be one per org (not per user)
-- Add connected_by_user_id (who connected it, for audit trail)
ALTER TABLE qbo_tokens ADD COLUMN IF NOT EXISTS connected_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Copy existing userId into connected_by_user_id
UPDATE qbo_tokens SET connected_by_user_id = user_id WHERE connected_by_user_id IS NULL;

-- Make org_id NOT NULL and UNIQUE (one QBO connection per org)
ALTER TABLE qbo_tokens ALTER COLUMN org_id SET NOT NULL;

-- Remove old per-user unique constraint if exists, add per-org unique
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'qbo_tokens_org_id_key'
  ) THEN
    ALTER TABLE qbo_tokens ADD CONSTRAINT qbo_tokens_org_id_key UNIQUE (org_id);
  END IF;
END $$;

-- 2. Create org_smtp_settings table
CREATE TABLE IF NOT EXISTS org_smtp_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE UNIQUE,
  host VARCHAR(255) NOT NULL,
  port INTEGER NOT NULL DEFAULT 2525,
  "user" VARCHAR(255) NOT NULL,
  pass TEXT NOT NULL,
  from_email VARCHAR(255) NOT NULL,
  from_name VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS org_smtp_settings_org_id_idx ON org_smtp_settings(org_id);

-- 3. Migrate existing SMTP env vars into EDC org (if you have them set)
-- Run this only if you have existing SMTP env vars configured
-- UPDATE org_smtp_settings SET ... (you'll configure via Settings UI instead)

-- Verify
SELECT 'qbo_tokens' as tbl, COUNT(*) as count FROM qbo_tokens
UNION ALL SELECT 'org_smtp_settings', COUNT(*) FROM org_smtp_settings;
