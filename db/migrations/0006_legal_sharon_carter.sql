ALTER TABLE "lead_tasks" ADD COLUMN "priority" varchar(12) DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD COLUMN "type" varchar(16) DEFAULT 'todo' NOT NULL;