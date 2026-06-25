CREATE TABLE IF NOT EXISTS "crm_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"lead_id" uuid,
	"org_id" uuid,
	"direction" varchar(8) NOT NULL,
	"thread_key" varchar(255) NOT NULL,
	"message_id" varchar(998),
	"in_reply_to" varchar(998),
	"from_addr" varchar(320) NOT NULL,
	"to_addr" text NOT NULL,
	"cc" text,
	"subject" varchar(500),
	"snippet" varchar(500),
	"body_html" text,
	"body_text" text,
	"mailbox_user_id" uuid,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_emails" ADD CONSTRAINT "crm_emails_account_id_crm_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."crm_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
