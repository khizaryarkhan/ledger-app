ALTER TABLE "invoices" ADD COLUMN "escalation_type" varchar(64);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "escalation_note" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "escalated_at" timestamp;
