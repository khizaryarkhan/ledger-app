CREATE TABLE IF NOT EXISTS "owner_portal_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "owner_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "owner_name" varchar(255) NOT NULL,
  "owner_email" varchar(255) NOT NULL,
  "token" varchar(80) NOT NULL UNIQUE,
  "invoice_ids" jsonb NOT NULL DEFAULT '[]',
  "status" varchar(16) NOT NULL DEFAULT 'Active',
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "expires_at" timestamp NOT NULL,
  "last_viewed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
