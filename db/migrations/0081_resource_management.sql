-- Resource Management (Phase 1: capacity & scheduling). `resources` is a
-- bookable person or piece of equipment; `resource_assignments` books one
-- against a Project/Manufacturing Order/Job Work order over a date range.
CREATE TABLE IF NOT EXISTS "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"type" varchar(16) NOT NULL,
	"employee_id" uuid,
	"name" varchar(160) NOT NULL,
	"category" varchar(80),
	"daily_capacity" numeric(6, 2) DEFAULT '1' NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resource_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"assignable_type" varchar(24) NOT NULL,
	"assignable_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"allocation_percent" numeric(5, 2) DEFAULT '100' NOT NULL,
	"status" varchar(16) DEFAULT 'scheduled' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resources" ADD CONSTRAINT "resources_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resources" ADD CONSTRAINT "resources_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resource_assignments" ADD CONSTRAINT "resource_assignments_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resource_assignments" ADD CONSTRAINT "resource_assignments_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resource_assignments" ADD CONSTRAINT "resource_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resources_org_type_status_idx" ON "resources" ("org_id","type","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_assignments_org_resource_dates_idx" ON "resource_assignments" ("org_id","resource_id","start_date","end_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_assignments_org_assignable_idx" ON "resource_assignments" ("org_id","assignable_type","assignable_id");
