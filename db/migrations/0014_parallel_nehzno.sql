ALTER TABLE "lead_tasks" ALTER COLUMN "lead_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD COLUMN "account_id" uuid;--> statement-breakpoint
UPDATE "lead_tasks" t SET "account_id" = l."account_id" FROM "landing_page_requests" l WHERE t."lead_id" = l."id" AND t."account_id" IS NULL;