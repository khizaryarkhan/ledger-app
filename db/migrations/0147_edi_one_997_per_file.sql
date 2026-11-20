-- EDI: at most ONE live 997 per received file. The app already returns the existing one when asked again, but two
-- simultaneous "make our 997" calls could both pass that check (neon-http has no transactions), so the database is the
-- real guard. ADDITIVE: one partial unique index. A duplicate is voided first (keeping the oldest) so the index can
-- never fail to build; none can exist on a database that has only run the app's own check.
UPDATE "edi_messages" m SET "status" = 'void', "void_reason" = 'Duplicate 997 for the same received file' WHERE m."doc_type" = '997' AND m."direction" = 'out' AND m."app_doc_type" = 'EdiFile' AND m."status" <> 'void' AND EXISTS (SELECT 1 FROM "edi_messages" o WHERE o."org_id" = m."org_id" AND o."app_doc_id" = m."app_doc_id" AND o."doc_type" = '997' AND o."direction" = 'out' AND o."app_doc_type" = 'EdiFile' AND o."status" <> 'void' AND (o."created_at", o."id") < (m."created_at", m."id"));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "edi_messages_one_997_per_file" ON "edi_messages" ("org_id", "app_doc_id") WHERE "doc_type" = '997' AND "direction" = 'out' AND "app_doc_type" = 'EdiFile' AND "status" <> 'void';
