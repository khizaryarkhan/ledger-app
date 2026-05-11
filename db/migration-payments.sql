-- =============================================================================
-- Migration: Payments, Payment Applications, Refund Receipts
-- Phase 1 of the AR event-sourcing migration.
-- Run this in your Neon SQL console.
-- Safe to run multiple times (uses IF NOT EXISTS).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PAYMENTS — QBO Receive Payment
-- One row per QBO Payment object. Applications are stored in the
-- payment_applications table below.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  qbo_id                   VARCHAR(64),
  customer_id              UUID REFERENCES customers(id) ON DELETE SET NULL,
  qbo_customer_id          VARCHAR(64),

  txn_date                 VARCHAR(16) NOT NULL,
  total_amount             REAL NOT NULL,
  unapplied_amount         REAL NOT NULL DEFAULT 0,
  currency                 VARCHAR(8) NOT NULL DEFAULT 'EUR',
  exchange_rate            REAL,

  payment_method           VARCHAR(64),
  payment_ref              VARCHAR(128),
  deposit_account_id       VARCHAR(64),
  deposit_account_name     VARCHAR(255),
  private_note             TEXT,

  qbo_synced_at            TIMESTAMP,
  created_at               TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMP NOT NULL DEFAULT NOW()
);

-- qboId is unique per org (allows nulls for manual entries)
CREATE UNIQUE INDEX IF NOT EXISTS payments_org_qbo_id_unique
  ON payments (org_id, qbo_id)
  WHERE qbo_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payments_org_customer_date_idx
  ON payments (org_id, customer_id, txn_date);

CREATE INDEX IF NOT EXISTS payments_org_txn_date_idx
  ON payments (org_id, txn_date DESC);

-- -----------------------------------------------------------------------------
-- PAYMENT_APPLICATIONS — links payments to invoices / credit memos
-- One row per (payment, target). targetType distinguishes invoice vs CM.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_applications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  payment_id      UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id      UUID REFERENCES invoices(id) ON DELETE SET NULL,
  target_qbo_id   VARCHAR(64) NOT NULL,
  target_type     VARCHAR(32) NOT NULL,  -- 'Invoice' or 'CreditMemo'
  amount_applied  REAL NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_applications_payment_target_unique
  ON payment_applications (payment_id, target_qbo_id, target_type);

CREATE INDEX IF NOT EXISTS payment_applications_invoice_idx
  ON payment_applications (invoice_id)
  WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_applications_org_idx
  ON payment_applications (org_id);

-- -----------------------------------------------------------------------------
-- REFUND_RECEIPTS — QBO RefundReceipt (money paid out to a customer)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refund_receipts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  qbo_id                   VARCHAR(64),
  customer_id              UUID REFERENCES customers(id) ON DELETE SET NULL,
  qbo_customer_id          VARCHAR(64),

  txn_date                 VARCHAR(16) NOT NULL,
  total_amount             REAL NOT NULL,
  currency                 VARCHAR(8) NOT NULL DEFAULT 'EUR',

  payment_method           VARCHAR(64),
  refund_from_account_id   VARCHAR(64),
  refund_from_account_name VARCHAR(255),
  private_note             TEXT,

  qbo_synced_at            TIMESTAMP,
  created_at               TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS refund_receipts_org_qbo_id_unique
  ON refund_receipts (org_id, qbo_id)
  WHERE qbo_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS refund_receipts_org_customer_date_idx
  ON refund_receipts (org_id, customer_id, txn_date);
