-- Re-applies migrations 0016 and 0017, which drizzle SILENTLY SKIPPED: their
-- journal `when` values (1751299200000 / 1751385600000) are earlier than
-- 0015's (1782693627858), and drizzle ignores any entry not newer than the
-- last applied one. Production was patched by hand (see
-- /api/migrate/add-comms-message-id), but a FRESH database still skips them —
-- and without communications.message_id every read of that table fails, so a
-- newly onboarded tenant would have broken timelines and comms logging.
--
-- Found while testing the customer-portal fix: a note-only response couldn't be
-- logged because this column was missing on a database built from migrations.
-- All three are IF NOT EXISTS, so this is a no-op where they already exist.
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN IF NOT EXISTS "message_id" text;
--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN IF NOT EXISTS "in_reply_to" text;
