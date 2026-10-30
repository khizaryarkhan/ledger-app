ALTER TABLE "trade_documents" ADD COLUMN IF NOT EXISTS "stage" varchar(40);
--> statement-breakpoint
ALTER TABLE "trade_documents" ADD COLUMN IF NOT EXISTS "rejected_at" timestamp;
--> statement-breakpoint
ALTER TABLE "trade_documents" ADD COLUMN IF NOT EXISTS "rejected_by" uuid;
--> statement-breakpoint
ALTER TABLE "trade_documents" ADD COLUMN IF NOT EXISTS "reject_reason" text;
--> statement-breakpoint
ALTER TABLE "trade_document_lines" ADD COLUMN IF NOT EXISTS "close_code" varchar(32);
--> statement-breakpoint
ALTER TABLE "trade_document_lines" ADD COLUMN IF NOT EXISTS "closed_by" uuid;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "po_stages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "key" varchar(40) NOT NULL,
  "label" varchar(60) NOT NULL,
  "color" varchar(16) DEFAULT 'stone' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "po_stages_org_key_uq" ON "po_stages" ("org_id", "key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_portal_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "document_id" uuid NOT NULL REFERENCES "trade_documents"("id") ON DELETE CASCADE,
  "token" varchar(80) NOT NULL UNIQUE,
  "status" varchar(16) DEFAULT 'Active' NOT NULL,
  "created_by" uuid,
  "expires_at" timestamp NOT NULL,
  "last_viewed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_portal_tokens_doc_idx" ON "supplier_portal_tokens" ("document_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "po_supplier_responses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "document_id" uuid NOT NULL REFERENCES "trade_documents"("id") ON DELETE CASCADE,
  "token_id" uuid,
  "kind" varchar(12) NOT NULL,
  "status" varchar(12) DEFAULT 'pending' NOT NULL,
  "message" text,
  "reply" text,
  "decided_by" uuid,
  "decided_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "po_supplier_responses_doc_idx" ON "po_supplier_responses" ("document_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "po_line_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE CASCADE,
  "response_id" uuid NOT NULL REFERENCES "po_supplier_responses"("id") ON DELETE CASCADE,
  "line_id" uuid NOT NULL REFERENCES "trade_document_lines"("id") ON DELETE CASCADE,
  "original_qty" numeric(16,6) NOT NULL,
  "original_date" varchar(16),
  "proposed_qty" numeric(16,6) NOT NULL,
  "proposed_date" varchar(16),
  "decision" varchar(12)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "po_line_revisions_resp_idx" ON "po_line_revisions" ("response_id");
