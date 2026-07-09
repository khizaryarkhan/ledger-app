-- Collections board "Next action" queue column — the forward-looking
-- counterpart to Last Sent. Set manually or by future automation.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "next_action_date" varchar(16);
