-- File attachments per document — QBO form-parity, Phase 4 (2026-10-25).
-- Polymorphic (doc_type/doc_id) across journal_entries ("ledger") and
-- trade_documents ("trade"), same tradeoff transaction_links already
-- accepts; see db/schema.ts's documentAttachments doc comment for why
-- blob_url is never returned to the client directly.
CREATE TABLE IF NOT EXISTS "document_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"doc_type" varchar(16) NOT NULL,
	"doc_id" uuid NOT NULL,
	"filename" varchar(255) NOT NULL,
	"content_type" varchar(128),
	"size_bytes" integer,
	"blob_url" varchar(2048) NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_attachments" ADD CONSTRAINT "document_attachments_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "organisations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_attachments_doc_idx" ON "document_attachments" ("org_id","doc_type","doc_id");
