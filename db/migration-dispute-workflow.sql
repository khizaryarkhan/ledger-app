-- =============================================================================
-- Migration: Dispute action workflow (ownership + structured outcomes)
-- Run in Neon SQL console. Safe to re-run (IF NOT EXISTS).
-- =============================================================================

ALTER TABLE invoice_disputes ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE invoice_disputes ADD COLUMN IF NOT EXISTS outcome     VARCHAR(32);

CREATE INDEX IF NOT EXISTS invoice_disputes_assigned_idx ON invoice_disputes (assigned_to);
