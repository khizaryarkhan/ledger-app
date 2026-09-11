-- Per-org opt-OUT for QBO "Pay now" links (email body, invoice PDF, customer
-- portal). Defaults to true: the links already self-gate on QBO issuing an
-- InvoiceLink at all, which only happens when the company has online payments
-- enabled — so this is for the org that CAN take online payments but would
-- rather its customers didn't self-pay.
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "pay_links_enabled" boolean DEFAULT true NOT NULL;
