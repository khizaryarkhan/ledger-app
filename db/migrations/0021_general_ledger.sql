CREATE TABLE IF NOT EXISTS "journal_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "entry_number" integer NOT NULL,
  "entry_date" varchar(16) NOT NULL,
  "memo" text,
  "source_type" varchar(32) NOT NULL DEFAULT 'Manual',
  "source_id" uuid,
  "status" varchar(16) NOT NULL DEFAULT 'Posted',
  "reversed_by_entry_id" uuid,
  "reverses_entry_id" uuid,
  "created_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "journal_entries_org_number_unique" ON "journal_entries" ("org_id","entry_number");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journal_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "entry_id" uuid NOT NULL REFERENCES "journal_entries"("id") ON DELETE cascade,
  "line_no" integer NOT NULL,
  "account_id" uuid NOT NULL REFERENCES "ap_accounts"("id"),
  "description" text,
  "debit" real NOT NULL DEFAULT 0,
  "credit" real NOT NULL DEFAULT 0,
  "class_id" uuid,
  "location_id" uuid,
  "cost_centre_id" uuid,
  "customer_id" uuid REFERENCES "customers"("id") ON DELETE set null,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE set null,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_lines_entry_idx" ON "journal_lines" ("entry_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_lines_org_account_idx" ON "journal_lines" ("org_id","account_id");
