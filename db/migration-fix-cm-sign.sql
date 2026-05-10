-- Migration: normalise credit memo sign convention
-- CMs use negative values throughout:
--   total      = negative face value  (e.g. -5000)
--   qbo_balance = negative unapplied balance (e.g. -3000; 0 if fully applied)
--   paid       = 0 (not applicable for credit memos)
--
-- This corrects any CMs previously stored with positive values.
-- Safe to re-run (WHERE total > 0 only touches rows not yet fixed).

UPDATE invoices
SET
  amount      = -ABS(amount),
  total       = -ABS(total),
  qbo_balance = -ABS(qbo_balance),
  paid        = 0,
  updated_at  = NOW()
WHERE txn_type = 'CreditMemo'
  AND total > 0;
