-- EDI Phase 1 (docs/prd-edi.md §3.1, §3.4). ADDITIVE: two new tables.
--
-- edi_partners: one EDI profile per party (supplier or customer): test/live, standard and version, both sides'
-- interchange IDs and qualifiers, how files travel (Phase 1: "manual" — the file is generated and kept here, a
-- person downloads it and delivers it through the partner's portal / mailbox / SFTP and marks it sent), the
-- partner's rules (must every line carry their part number / a GTIN), and per-partner unit-code overrides.
-- next_control_no is the outbound interchange/group control number: allocated with ONE UPDATE … RETURNING, never
-- reused, even when the file it went into is voided (X12: a control number names one interchange, forever).
CREATE TABLE IF NOT EXISTS "edi_partners" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "party_id" uuid NOT NULL REFERENCES "parties"("id") ON DELETE cascade,
  "enabled" boolean DEFAULT true NOT NULL,
  "mode" varchar(4) DEFAULT 'test' NOT NULL,
  "standard" varchar(8) DEFAULT 'x12' NOT NULL,
  "version" varchar(8) DEFAULT '004010' NOT NULL,
  "sender_qualifier" varchar(2) NOT NULL,
  "sender_id" varchar(15) NOT NULL,
  "receiver_qualifier" varchar(2) NOT NULL,
  "receiver_id" varchar(15) NOT NULL,
  "sender_app_id" varchar(15),
  "receiver_app_id" varchar(15),
  "transport" varchar(16) DEFAULT 'manual' NOT NULL,
  "docs_out" jsonb DEFAULT '["850"]'::jsonb NOT NULL,
  "require_part_number" boolean DEFAULT true NOT NULL,
  "require_gtin" boolean DEFAULT false NOT NULL,
  "unit_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "next_control_no" bigint DEFAULT 1 NOT NULL,
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- One profile per party.
CREATE UNIQUE INDEX IF NOT EXISTS "edi_partners_party_uq" ON "edi_partners" ("org_id", "party_id");
--> statement-breakpoint
-- Every EDI file in or out, with its raw payload kept so a dispute can be settled from the file itself.
-- app_doc_type/app_doc_id name the app record (no FK: polymorphic, like transaction_links). A message is never
-- deleted; a file that should not go is voided, and its control number is still never reused.
CREATE TABLE IF NOT EXISTS "edi_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "partner_id" uuid NOT NULL REFERENCES "edi_partners"("id") ON DELETE restrict,
  "party_id" uuid REFERENCES "parties"("id") ON DELETE set null,
  "direction" varchar(3) NOT NULL,
  "doc_type" varchar(8) NOT NULL,
  "standard" varchar(8) NOT NULL,
  "version" varchar(8) NOT NULL,
  "test" boolean NOT NULL,
  "status" varchar(16) DEFAULT 'generated' NOT NULL,
  "interchange_no" bigint NOT NULL,
  "group_no" bigint NOT NULL,
  "txn_no" varchar(9) NOT NULL,
  "app_doc_type" varchar(24),
  "app_doc_id" uuid,
  "app_doc_number" varchar(64),
  "file_name" varchar(128) NOT NULL,
  "payload" text NOT NULL,
  "payload_sha256" varchar(64) NOT NULL,
  "error" text,
  "void_reason" text,
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "sent_at" timestamp,
  "sent_by" uuid
);
--> statement-breakpoint
-- A control number names one interchange with one partner in one direction.
CREATE UNIQUE INDEX IF NOT EXISTS "edi_messages_control_uq" ON "edi_messages" ("partner_id", "direction", "interchange_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "edi_messages_doc_idx" ON "edi_messages" ("org_id", "app_doc_id");
