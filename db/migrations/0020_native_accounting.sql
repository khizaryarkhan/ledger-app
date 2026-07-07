-- Native accounting phase 1/2: items need the sales side (QBO items carry
-- both a sales price/income account and a purchase cost/expense account).
ALTER TABLE "ap_items" ADD COLUMN IF NOT EXISTS "item_type" varchar(32) DEFAULT 'Service';
ALTER TABLE "ap_items" ADD COLUMN IF NOT EXISTS "unit_price" real;
ALTER TABLE "ap_items" ADD COLUMN IF NOT EXISTS "income_account_id" varchar(64);
