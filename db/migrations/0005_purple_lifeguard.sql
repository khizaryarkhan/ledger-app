CREATE TABLE IF NOT EXISTS "crm_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"lead_id" uuid,
	"org_id" uuid,
	"opportunity_id" uuid,
	"type" varchar(40) NOT NULL,
	"title" varchar(300) NOT NULL,
	"body" text,
	"meta" jsonb,
	"actor_id" uuid,
	"actor_name" varchar(255),
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_account_id_crm_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."crm_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
