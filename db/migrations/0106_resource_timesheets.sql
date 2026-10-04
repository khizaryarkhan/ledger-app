-- Resources Phase 2: timesheets, capacity & leave. Real labour expense capture,
-- mapped to the GL via Timesheet Types, distinct from Phase 1's forward-looking
-- resource_assignments and from a Manufacturing Order's own standard-cost
-- labour absorption at completion (hours x work-centre rate, no link to any
-- person or real pay cost). The standard-vs-actual variance that compares the
-- two is a deliberate, separate follow-on, not built here.
CREATE TABLE IF NOT EXISTS "holiday_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
	"name" varchar(128) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "holiday_calendars_org_default_unique" ON "holiday_calendars" ("org_id") WHERE "is_default" = true;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "public_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
	"calendar_id" uuid NOT NULL REFERENCES "holiday_calendars"("id") ON DELETE cascade,
	"date" date NOT NULL,
	"name" varchar(128) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "public_holidays_calendar_date_idx" ON "public_holidays" ("calendar_id", "date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "timesheet_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
	"name" varchar(128) NOT NULL,
	"category" varchar(16) NOT NULL,
	"billable" boolean DEFAULT false NOT NULL,
	"requires_assignable" boolean DEFAULT false NOT NULL,
	"is_public_holiday" boolean DEFAULT false NOT NULL,
	"expense_account_id" uuid NOT NULL REFERENCES "accounts"("id"),
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "timesheet_types_org_category_idx" ON "timesheet_types" ("org_id", "category", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leave_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
	"timesheet_type_id" uuid NOT NULL REFERENCES "timesheet_types"("id") ON DELETE cascade,
	"accrual_method" varchar(16) NOT NULL,
	"accrual_amount_per_year" numeric(8,2) DEFAULT '0' NOT NULL,
	"carry_forward_cap" numeric(8,2),
	"reset_month" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "leave_policies_type_unique" ON "leave_policies" ("timesheet_type_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leave_balance_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
	"resource_id" uuid NOT NULL REFERENCES "resources"("id") ON DELETE cascade,
	"timesheet_type_id" uuid NOT NULL REFERENCES "timesheet_types"("id"),
	"date" date NOT NULL,
	"hours" numeric(8,2) NOT NULL,
	"source_type" varchar(16) NOT NULL,
	"source_id" uuid,
	"note" text,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leave_balance_entries_org_resource_type_date_idx" ON "leave_balance_entries" ("org_id", "resource_id", "timesheet_type_id", "date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "timesheet_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"entry_id" uuid,
	"total_hours" numeric(10,2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(14,2) DEFAULT '0' NOT NULL,
	"status" varchar(16) DEFAULT 'posted' NOT NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "timesheet_batches_org_period_unique" ON "timesheet_batches" ("org_id", "period_start", "period_end");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
	"resource_id" uuid NOT NULL REFERENCES "resources"("id") ON DELETE cascade,
	"date" date NOT NULL,
	"hours" numeric(6,2) NOT NULL,
	"timesheet_type_id" uuid NOT NULL REFERENCES "timesheet_types"("id"),
	"assignable_type" varchar(24),
	"assignable_id" uuid,
	"description" varchar(255),
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"rejected_reason" text,
	"batch_id" uuid REFERENCES "timesheet_batches"("id") ON DELETE SET NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"approved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_org_resource_date_idx" ON "time_entries" ("org_id", "resource_id", "date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_org_status_idx" ON "time_entries" ("org_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_org_assignable_idx" ON "time_entries" ("org_id", "assignable_type", "assignable_id");
--> statement-breakpoint
ALTER TABLE "resources"
	ADD COLUMN IF NOT EXISTS "cost_rate_per_hour" numeric(10,2),
	ADD COLUMN IF NOT EXISTS "holiday_calendar_id" uuid REFERENCES "holiday_calendars"("id") ON DELETE SET NULL,
	ADD COLUMN IF NOT EXISTS "working_days" integer[];
--> statement-breakpoint
ALTER TABLE "organisations"
	ADD COLUMN IF NOT EXISTS "payroll_frequency" varchar(16),
	ADD COLUMN IF NOT EXISTS "payroll_week_end_day" integer,
	ADD COLUMN IF NOT EXISTS "payroll_biweekly_anchor" date,
	ADD COLUMN IF NOT EXISTS "payroll_semimonthly_cutoff" integer,
	ADD COLUMN IF NOT EXISTS "payroll_month_cutoff" integer;
