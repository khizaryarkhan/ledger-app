-- Audit history per document — QBO form-parity, Phase 5 (2026-10-25). Reuses
-- the existing audit_events "track & trace" log rather than a new table, by
-- adding the same (doc_type, doc_id) polymorphic discriminator Print/
-- Download, Email/Send and Attachments already use. See db/schema.ts's
-- auditEvents doc comment.
ALTER TABLE "audit_events" ADD COLUMN IF NOT EXISTS "doc_type" varchar(16);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN IF NOT EXISTS "doc_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_doc_idx" ON "audit_events" ("org_id","doc_type","doc_id");
