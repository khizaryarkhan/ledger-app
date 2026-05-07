-- Migration: Collections Reference Number + Project comms/contacts
-- Run once, or: npm run db:push

ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS col_ref_seq INTEGER NOT NULL DEFAULT 0;

ALTER TABLE communications
  ADD COLUMN IF NOT EXISTS ref_number VARCHAR(32),
  ADD COLUMN IF NOT EXISTS stage_at_send VARCHAR(64),
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;
