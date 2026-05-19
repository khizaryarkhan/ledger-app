-- Migration: add microsoft_tokens table for OAuth email integration
-- Run this once against your Neon / Postgres database.

CREATE TABLE IF NOT EXISTS "microsoft_tokens" (
  "id"                      uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"                  uuid REFERENCES "organisations"("id") ON DELETE CASCADE,
  "user_id"                 uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "email"                   varchar(255) NOT NULL,
  "access_token"            text NOT NULL,
  "refresh_token"           text NOT NULL,
  "access_token_expires_at" timestamp NOT NULL,
  "created_at"              timestamp NOT NULL DEFAULT now(),
  "updated_at"              timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "microsoft_tokens_org_id_idx" ON "microsoft_tokens"("org_id");
