ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now();
