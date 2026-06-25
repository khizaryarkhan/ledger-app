ALTER TABLE "opportunities" ADD COLUMN "stripe_invoice_id" varchar(255);--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "invoice_url" text;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "invoice_total" integer;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "invoice_currency" varchar(3);--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "invoice_status" varchar(20);--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "invoiced_at" timestamp;