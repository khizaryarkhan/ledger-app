-- PAX Console phase 2 (2026-11-05). Additive only: three new tables.
--
--   pax_pending_actions  a change the model PROPOSED, waiting for the user to press Apply.
--                        The model never executes anything: the stored request is run by the
--                        server, as the user, only after that click.
--   pax_org_settings     what an organisation's admin allows: which providers, whether a
--                        custom endpoint may be used, whether the console may propose changes.
--   pax_consents         a user's acknowledgement that what the console reads is sent to the
--                        provider they chose.
--
-- One command per chunk (neon-http sends each as a prepared statement).

CREATE TABLE IF NOT EXISTS "pax_pending_actions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "conversation_id" uuid NOT NULL REFERENCES "pax_conversations"("id") ON DELETE CASCADE,
  "method" varchar(8) NOT NULL,
  "path" text NOT NULL,
  "query" jsonb,
  "body" jsonb,
  "summary" text NOT NULL,
  "status" varchar(10) DEFAULT 'pending' NOT NULL,
  "result" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL,
  "decided_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pax_pending_actions_conversation_idx" ON "pax_pending_actions" ("conversation_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pax_org_settings" (
  "org_id" uuid PRIMARY KEY NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "allowed_providers" jsonb,
  "allow_custom_endpoints" boolean DEFAULT true NOT NULL,
  "writes_enabled" boolean DEFAULT false NOT NULL,
  "consent_text" text,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pax_consents" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "accepted_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("user_id", "org_id")
);
