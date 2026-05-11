-- =============================================================================
-- Migration: QBO webhook events log
-- Run this in your Neon SQL console to enable webhook monitoring.
-- Safe to run multiple times (uses IF NOT EXISTS).
-- =============================================================================

CREATE TABLE IF NOT EXISTS qbo_webhook_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  realm_id        VARCHAR(64) NOT NULL,
  org_id          UUID REFERENCES organisations(id) ON DELETE SET NULL,
  status          VARCHAR(32) NOT NULL DEFAULT 'received',
  entity_count    INTEGER NOT NULL DEFAULT 0,
  entities        JSONB,
  error_message   TEXT,
  processing_ms   INTEGER
);

CREATE INDEX IF NOT EXISTS qbo_webhook_events_org_received_idx
  ON qbo_webhook_events (org_id, received_at DESC);

CREATE INDEX IF NOT EXISTS qbo_webhook_events_realm_idx
  ON qbo_webhook_events (realm_id);
