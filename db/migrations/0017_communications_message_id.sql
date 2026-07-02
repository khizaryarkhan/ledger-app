ALTER TABLE "communications" ADD COLUMN IF NOT EXISTS "message_id" text;
ALTER TABLE "communications" ADD COLUMN IF NOT EXISTS "in_reply_to" text;
