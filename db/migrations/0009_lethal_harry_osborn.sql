CREATE TABLE IF NOT EXISTS "forecast_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_date" varchar(16) NOT NULL,
	"open_pipeline" integer DEFAULT 0 NOT NULL,
	"weighted_pipeline" integer DEFAULT 0 NOT NULL,
	"won_value" integer DEFAULT 0 NOT NULL,
	"open_deals" integer DEFAULT 0 NOT NULL,
	"customers" integer DEFAULT 0 NOT NULL,
	"active_leads" integer DEFAULT 0 NOT NULL,
	"mrr" integer DEFAULT 0 NOT NULL,
	"by_stage" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
