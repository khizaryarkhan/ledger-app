CREATE TABLE IF NOT EXISTS "crm_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"channel" varchar(32) DEFAULT 'other' NOT NULL,
	"utm_key" varchar(120),
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"start_date" varchar(16),
	"end_date" varchar(16),
	"budget" integer,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "landing_page_requests" ADD COLUMN "campaign_id" uuid;