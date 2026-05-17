-- Migration: DB-driven cron state
-- contacts.next_send_at   — when to next email this contact (NULL = send on next run)
-- organisations.last_cron_run   — timestamp of the last cron execution
-- organisations.last_cron_stats — { escalated, emailsSent, skipped, errors[] }

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS next_send_at timestamp;

ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS last_cron_run timestamp;

ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS last_cron_stats jsonb;
