-- Migration: Per-template send interval
-- Replaces the short-lived schedule_days (day-offset array) with send_interval_days.
-- send_interval_days = how often in days the cron re-sends to each contact.
-- e.g. 7 = weekly, 14 = fortnightly, 30 = monthly.
-- Run once, or: npm run db:push

-- Remove the day-offset column if it was added by a previous run
ALTER TABLE email_templates DROP COLUMN IF EXISTS schedule_days;

-- Add the interval column (default: weekly)
ALTER TABLE email_templates
  ADD COLUMN IF NOT EXISTS send_interval_days integer NOT NULL DEFAULT 7;
