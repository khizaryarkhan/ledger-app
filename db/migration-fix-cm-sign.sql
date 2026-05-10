-- Migration: fix credit memo sign convention
-- Credit memos were stored with negative total/amount/qboBalance.
-- New convention mirrors invoices: all values positive, paid = applied amount.
-- Safe to re-run (WHERE total < 0 only touches rows not yet fixed).

UPDATE invoices
SET
  amount      = ABS(amount),
  total       = ABS(total),
  paid        = GREATEST(0, ABS(total) - ABS(qbo_balance)),
  qbo_balance = ABS(qbo_balance),
  updated_at  = NOW()
WHERE txn_type = 'CreditMemo'
  AND total < 0;
