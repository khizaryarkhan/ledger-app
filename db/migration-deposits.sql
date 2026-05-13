-- AR-affecting deposit lines.
-- One row per Deposit.Line where the line's offset account is Accounts Receivable
-- and the line has an Entity (customer) reference. The amount is signed (negative
-- means AR credit / customer overpayment sitting on account).

CREATE TABLE IF NOT EXISTS deposits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  qbo_id          VARCHAR(64) NOT NULL,
  qbo_line_id     VARCHAR(64),

  customer_id     UUID REFERENCES customers(id) ON DELETE SET NULL,
  qbo_customer_id VARCHAR(64),

  account_id      VARCHAR(64),
  account_name    VARCHAR(255),

  txn_date        VARCHAR(16) NOT NULL,
  amount          REAL NOT NULL,
  currency        VARCHAR(8) NOT NULL DEFAULT 'EUR',

  description     TEXT,
  private_note    TEXT,

  qbo_synced_at   TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS deposits_org_qbo_line_unique
  ON deposits (org_id, qbo_id, qbo_line_id)
  WHERE qbo_line_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS deposits_org_customer_idx
  ON deposits (org_id, customer_id);
