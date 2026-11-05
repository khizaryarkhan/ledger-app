-- PAX Console (2026-11-05): an in-app chat where each user connects their own
-- AI model. Additive only — three new tables, nothing existing is touched, and no
-- organisation sees the module until an admin ticks it (enabled_modules).
--
-- One command per chunk (neon-http sends each as a prepared statement).

CREATE TABLE IF NOT EXISTS "user_ai_models" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider" varchar(40) NOT NULL,
  "model" varchar(160) NOT NULL,
  "base_url" text,
  "api_key_enc" text NOT NULL,
  "key_last4" varchar(8) NOT NULL,
  "tier" varchar(8) DEFAULT 'read' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_ai_models_user_idx" ON "user_ai_models" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pax_conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" varchar(200) DEFAULT 'New chat' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pax_conversations_owner_idx" ON "pax_conversations" ("user_id", "org_id", "updated_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pax_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "pax_conversations"("id") ON DELETE CASCADE,
  "role" varchar(12) NOT NULL,
  "message" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pax_messages_conversation_idx" ON "pax_messages" ("conversation_id", "created_at");
