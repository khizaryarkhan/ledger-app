-- Make integration state visible to every user in an organisation.
--
-- Problem: gmail_tokens and qbo_sync_log were keyed by user_id only.
-- A Company Admin couldn't see that the Super Admin had connected Gmail
-- or run QBO syncs because those records belonged to a different user.
--
-- Fix: add org_id, backfill from the user's primary org, and make every
-- status query org-scoped going forward.

-- 1. qbo_sync_log: add org_id, backfill
ALTER TABLE qbo_sync_log
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organisations(id) ON DELETE CASCADE;

UPDATE qbo_sync_log l
SET    org_id = u.org_id
FROM   users u
WHERE  l.user_id = u.id
  AND  l.org_id IS NULL
  AND  u.org_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS qbo_sync_log_org_idx ON qbo_sync_log (org_id, synced_at DESC);

-- 2. gmail_tokens: add org_id, backfill, enforce one per org
ALTER TABLE gmail_tokens
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organisations(id) ON DELETE CASCADE;

UPDATE gmail_tokens g
SET    org_id = u.org_id
FROM   users u
WHERE  g.user_id = u.id
  AND  g.org_id IS NULL
  AND  u.org_id IS NOT NULL;

-- Optional: prevent duplicate Gmail connections per org. If you currently
-- have multiple tokens for the same org (e.g. two users each connected),
-- this index will fail — drop the older ones first if so.
CREATE UNIQUE INDEX IF NOT EXISTS gmail_tokens_org_unique ON gmail_tokens (org_id) WHERE org_id IS NOT NULL;
