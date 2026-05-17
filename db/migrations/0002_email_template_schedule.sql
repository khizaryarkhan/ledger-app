-- Migration: Per-template send schedule
-- Adds schedule_days (integer[]) to email_templates.
-- Default keeps the previous hardcoded behaviour: -3, 1, 8, 21 days relative to due date.
-- Run once, or: npm run db:push

ALTER TABLE email_templates
  ADD COLUMN IF NOT EXISTS schedule_days integer[] NOT NULL DEFAULT '{-3,1,8,21}';
