-- Migration: Collections Reference Number + Comms Log enhancements
-- Run once against your Neon database, OR run: npm run db:push

ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS col_ref_seq INTEGER NOT NULL DEFAULT 0;

ALTER TABLE communications
  ADD COLUMN IF NOT EXISTS ref_number VARCHAR(32),
  ADD COLUMN IF NOT EXISTS stage_at_send VARCHAR(64);
