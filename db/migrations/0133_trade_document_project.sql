-- Estimates and Sales Orders can name the customer's project (picked from the
-- customer dropdown, as on invoices). Nullable: every existing document keeps
-- meaning exactly what it did. No FK, same as sales_order_id on this table.
ALTER TABLE "trade_documents" ADD COLUMN IF NOT EXISTS "project_id" uuid;
