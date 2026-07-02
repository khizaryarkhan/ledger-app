ALTER TABLE "invoices" ADD COLUMN "escalated_to_user_id" uuid REFERENCES "users"("id");
ALTER TABLE "invoices" ADD COLUMN "escalated_to_name" varchar(255);
ALTER TABLE "invoices" ADD COLUMN "escalated_to_email" varchar(255);
