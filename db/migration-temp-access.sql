-- Temporary access requests for cancelled organisations
-- Run this on your Neon database.

CREATE TABLE IF NOT EXISTS temp_access_requests (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id                uuid NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  requested_by_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  requested_by_email    varchar(255),
  reason                text,
  status                varchar(32) NOT NULL DEFAULT 'pending',
  reviewed_by_admin_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at           timestamptz,
  expires_at            timestamptz,
  admin_notes           text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_temp_access_org_id ON temp_access_requests(org_id);
