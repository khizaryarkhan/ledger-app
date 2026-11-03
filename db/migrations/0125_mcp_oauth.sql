-- MCP server (2026-11-03): OAuth clients, authorization codes and issued tokens.
--
-- Additive only — three new tables, nothing existing is touched. Tokens are stored
-- as SHA-256 hashes (never the token), so each can be revoked and none can be
-- replayed from a database read.
--
-- One command per chunk (neon-http sends each as a prepared statement).

CREATE TABLE IF NOT EXISTS "mcp_clients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" varchar(64) NOT NULL,
  "client_name" varchar(200) NOT NULL,
  "redirect_uris" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "mcp_clients_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mcp_auth_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code_hash" varchar(64) NOT NULL,
  "client_id" varchar(64) NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "scopes" text NOT NULL,
  "code_challenge" varchar(128) NOT NULL,
  "redirect_uri" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "mcp_auth_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mcp_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" varchar(64) NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "scopes" text NOT NULL,
  "access_hash" varchar(64) NOT NULL,
  "refresh_hash" varchar(64) NOT NULL,
  "access_expires_at" timestamp NOT NULL,
  "refresh_expires_at" timestamp NOT NULL,
  "revoked_at" timestamp,
  "last_used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "mcp_tokens_access_hash_unique" UNIQUE("access_hash"),
  CONSTRAINT "mcp_tokens_refresh_hash_unique" UNIQUE("refresh_hash")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_tokens_user_idx" ON "mcp_tokens" ("user_id");
