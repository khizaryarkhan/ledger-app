-- EDI Phase 2 (docs/prd-edi.md §5): reading what the partner sends back. ADDITIVE: four nullable columns.
--
-- On an OUTBOUND file: ack_status / acked_at / ack_message_id = the 997 that answered it (accepted, accepted with
-- errors, partially accepted, rejected), and which inbound file said so. On an INBOUND file: result = what was done
-- with each transaction set (applied, needs review with the reasons in words, or ignored), so a person can see
-- why without re-reading the X12. Inbound status: processed | review | ignored.
ALTER TABLE "edi_messages" ADD COLUMN IF NOT EXISTS "ack_status" varchar(24), ADD COLUMN IF NOT EXISTS "acked_at" timestamp, ADD COLUMN IF NOT EXISTS "ack_message_id" uuid, ADD COLUMN IF NOT EXISTS "result" jsonb;
