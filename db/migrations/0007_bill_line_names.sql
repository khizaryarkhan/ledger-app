-- Migration 0007: Add account_name and item_name to ap_bill_lines
-- These store the human-readable names from QBO AccountRef.name / ItemRef.name
-- so the bill detail UI can show "Software Expense" instead of a numeric ID.

ALTER TABLE ap_bill_lines
  ADD COLUMN IF NOT EXISTS account_name VARCHAR(256),
  ADD COLUMN IF NOT EXISTS item_name    VARCHAR(256);
