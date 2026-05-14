-- Add per-line application tracking to payment_applications.
--
-- Background: QBO's Payment.Line.LinkedTxn entries can include a TxnLineId
-- that identifies a specific sub-line on the target transaction. For
-- Journal Entries this is critical — one JE header can have multiple AR
-- lines for different customers, and a payment applies to a specific line,
-- not the whole header.
--
-- The previous unique index keyed on (payment_id, target_qbo_id, target_type)
-- would have blocked storing two applications from the same payment to two
-- different lines of the same JE. Replace it with an index that includes
-- target_line_id so each (payment, target, line) combination is unique.

ALTER TABLE payment_applications
  ADD COLUMN IF NOT EXISTS target_line_id VARCHAR(64);

DROP INDEX IF EXISTS payment_applications_payment_target_unique;

CREATE UNIQUE INDEX IF NOT EXISTS payment_applications_payment_target_line_unique
  ON payment_applications (payment_id, target_qbo_id, target_type, target_line_id);
