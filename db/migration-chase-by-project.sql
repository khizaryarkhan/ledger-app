-- Add chase_by_project flag to customers
-- When true: customer is excluded from customer-level chasing;
--            their projects appear in the By Project automation list instead.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS chase_by_project boolean NOT NULL DEFAULT false;
