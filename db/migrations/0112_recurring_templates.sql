-- Recurring document templates — QBO form-parity, Phase 6 "Make Recurring"
-- (2026-10-25). See db/schema.ts's recurringTemplates doc comment.
CREATE TABLE IF NOT EXISTS "recurring_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"source_type" varchar(24) NOT NULL,
	"template_name" varchar(255) NOT NULL,
	"payload" jsonb NOT NULL,
	"frequency" varchar(16) NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"start_date" varchar(16) NOT NULL,
	"end_type" varchar(16) DEFAULT 'never' NOT NULL,
	"end_after_count" integer,
	"end_on_date" varchar(16),
	"occurrences_created" integer DEFAULT 0 NOT NULL,
	"next_run_date" varchar(16) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"auto_send" boolean DEFAULT false NOT NULL,
	"last_run_at" timestamp,
	"last_run_entry_id" uuid,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recurring_templates" ADD CONSTRAINT "recurring_templates_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurring_templates_due_idx" ON "recurring_templates" ("org_id","active","next_run_date");
