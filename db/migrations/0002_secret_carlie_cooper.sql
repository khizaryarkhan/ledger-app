CREATE TABLE IF NOT EXISTS "crm_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"match_key" varchar(255) NOT NULL,
	"domain" varchar(255),
	"billing_email" varchar(255),
	"phone" varchar(64),
	"country" varchar(100),
	"industry" varchar(128),
	"lifecycle_stage" varchar(32) DEFAULT 'lead' NOT NULL,
	"organisation_id" uuid,
	"stripe_customer_id" text,
	"owner_admin_id" uuid,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "crm_accounts_match_key_unique" UNIQUE("match_key")
);
--> statement-breakpoint
ALTER TABLE "landing_page_requests" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "account_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_accounts" ADD CONSTRAINT "crm_accounts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crm_accounts" ADD CONSTRAINT "crm_accounts_owner_admin_id_users_id_fk" FOREIGN KEY ("owner_admin_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
