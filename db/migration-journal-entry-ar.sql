-- =============================================================================
-- Migration: Journal Entry AR Lines
-- Captures the AR-affecting lines of QBO Journal Entries so AR Aging is
-- accurate for customers with AR adjustments (write-offs, audit corrections,
-- inter-company transfers, etc.).
--
-- Run this in your Neon SQL console before the next sync.
-- Safe to run multiple times (uses IF NOT EXISTS).
-- =============================================================================

CREATE TABLE IF NOT EXISTS journal_entry_ar_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,

  qbo_journal_id    VARCHAR(64) NOT NULL,
  qbo_line_id       VARCHAR(64),
  doc_number        VARCHAR(64),

  customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
  qbo_customer_id   VARCHAR(64),

  account_id        VARCHAR(64),
  account_name      VARCHAR(255),

  txn_date          VARCHAR(16) NOT NULL,
  amount            REAL NOT NULL,                    -- signed: + = debit AR, - = credit AR
  currency          VARCHAR(8) NOT NULL DEFAULT 'EUR',
  exchange_rate     REAL,

  description       TEXT,
  voided            BOOLEAN NOT NULL DEFAULT FALSE,

  qbo_synced_at     TIMESTAMP,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS je_ar_lines_org_journal_line_unique
  ON journal_entry_ar_lines (org_id, qbo_journal_id, qbo_line_id);

CREATE INDEX IF NOT EXISTS je_ar_lines_org_customer_date_idx
  ON journal_entry_ar_lines (org_id, customer_id, txn_date);

CREATE INDEX IF NOT EXISTS je_ar_lines_org_date_idx
  ON journal_entry_ar_lines (org_id, txn_date DESC);
