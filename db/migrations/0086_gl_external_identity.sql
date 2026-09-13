-- GL ingestion foundation: make a mirrored provider transaction identifiable
-- and re-postable exactly once.
--
-- journal_entries has carried external_id / external_source / external_sync_token
-- since it was designed ("QBO/Xero transaction id when synced/mirrored") and
-- lib/ledger.ts's postJournalEntry already accepts externalId — but nothing has
-- ever written them, and there is no uniqueness guarantee. Without one, a
-- re-sync (or a webhook replay, which this app already sees in volume) would
-- post the same QBO transaction into the ledger a second time. In a general
-- ledger that is not a duplicate row, it is a wrong trial balance.
--
-- PARTIAL unique index, so the millions of ordinary native entries — which have
-- external_id NULL and always will — are neither constrained nor indexed. Only
-- mirrored entries participate.
CREATE UNIQUE INDEX IF NOT EXISTS "journal_entries_org_external_unique"
  ON "journal_entries" ("org_id", "external_source", "external_id")
  WHERE "external_id" IS NOT NULL;
--> statement-breakpoint

-- Lookup index for the ingestion path: "do I already hold this QBO txn, and at
-- which SyncToken?" runs once per transaction considered, so it must not scan.
CREATE INDEX IF NOT EXISTS "journal_entries_external_lookup_idx"
  ON "journal_entries" ("org_id", "external_source", "external_id", "external_sync_token")
  WHERE "external_id" IS NOT NULL;
