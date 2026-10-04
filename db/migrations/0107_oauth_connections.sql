-- Consolidates gmail_tokens / google_sheets_tokens / microsoft_tokens — three
-- byte-for-byte identical tables, one per OAuth provider — into a single
-- oauth_connections table with a provider discriminator, matching this
-- codebase's own pattern (parties, ap_dimensions). Backfills existing rows;
-- the three old tables are left in place as a rollback safety net and are
-- dropped in a later migration once this is confirmed working in production.
CREATE TABLE IF NOT EXISTS "oauth_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid REFERENCES "organisations"("id") ON DELETE cascade,
	"provider" varchar(16) NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"email" varchar(255) NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"access_token_expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_connections_org_provider_unique" ON "oauth_connections" ("org_id","provider");
--> statement-breakpoint
INSERT INTO "oauth_connections" (org_id, provider, user_id, email, access_token, refresh_token, access_token_expires_at, created_at, updated_at)
SELECT org_id, 'gmail', user_id, email, access_token, refresh_token, access_token_expires_at, created_at, updated_at FROM "gmail_tokens"
ON CONFLICT ("org_id", "provider") DO NOTHING;
--> statement-breakpoint
INSERT INTO "oauth_connections" (org_id, provider, user_id, email, access_token, refresh_token, access_token_expires_at, created_at, updated_at)
SELECT org_id, 'google_sheets', user_id, email, access_token, refresh_token, access_token_expires_at, created_at, updated_at FROM "google_sheets_tokens"
ON CONFLICT ("org_id", "provider") DO NOTHING;
--> statement-breakpoint
INSERT INTO "oauth_connections" (org_id, provider, user_id, email, access_token, refresh_token, access_token_expires_at, created_at, updated_at)
SELECT org_id, 'microsoft', user_id, email, access_token, refresh_token, access_token_expires_at, created_at, updated_at FROM "microsoft_tokens"
ON CONFLICT ("org_id", "provider") DO NOTHING;
