ALTER TABLE "landing_page_requests" ADD COLUMN "value" integer;--> statement-breakpoint
ALTER TABLE "landing_page_requests" ADD COLUMN "deal_currency" varchar(3);--> statement-breakpoint
ALTER TABLE "landing_page_requests" ADD COLUMN "expected_close_date" timestamp;