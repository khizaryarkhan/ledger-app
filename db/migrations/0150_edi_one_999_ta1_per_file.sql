-- EDI: at most ONE live 999 and ONE live TA1 per received file, the same guarantee 0147 gave the 997 (two simultaneous "make our
-- acknowledgement" calls could both pass the app's own check, as neon-http has no transactions). ADDITIVE: two partial unique
-- indexes. No 999 or TA1 is ever written before this migration, so none can already be a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS "edi_messages_one_999_per_file" ON "edi_messages" ("org_id", "app_doc_id") WHERE "doc_type" = '999' AND "direction" = 'out' AND "app_doc_type" = 'EdiFile' AND "status" <> 'void';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "edi_messages_one_ta1_per_file" ON "edi_messages" ("org_id", "app_doc_id") WHERE "doc_type" = 'TA1' AND "direction" = 'out' AND "app_doc_type" = 'EdiFile' AND "status" <> 'void';
