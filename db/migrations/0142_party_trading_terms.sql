-- EDI foundation, trading terms (docs/prd-edi.md Phase 0 item 4). ADDITIVE: nullable columns and one new table.
-- Nothing is back-filled; a party with none of these set behaves exactly as before.
--
-- parties: our account number WITH this party (the number they know us by: X12 REF*IA / N1 code), the early-payment
-- discount (2% within 10 days, X12 ITD), and the default Incoterm with its named place (ICC Incoterms 2020).
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "our_account_number" varchar(64), ADD COLUMN IF NOT EXISTS "discount_percent" numeric(5,2), ADD COLUMN IF NOT EXISTS "discount_days" integer, ADD COLUMN IF NOT EXISTS "incoterm" varchar(3), ADD COLUMN IF NOT EXISTS "incoterm_place" varchar(128);
--> statement-breakpoint
-- The same terms COPIED onto each purchase / sales order when it is created, so changing a supplier's terms later
-- never rewrites what an order already said.
ALTER TABLE "trade_documents" ADD COLUMN IF NOT EXISTS "payment_terms_days" integer, ADD COLUMN IF NOT EXISTS "discount_percent" numeric(5,2), ADD COLUMN IF NOT EXISTS "discount_days" integer, ADD COLUMN IF NOT EXISTS "incoterm" varchar(3), ADD COLUMN IF NOT EXISTS "incoterm_place" varchar(128);
--> statement-breakpoint
-- Supplier contacts: who to send orders to, who handles invoices, deliveries, EDI. Deliberately NOT the `contacts`
-- table, which belongs to collections (auto-chase, escalation) and is keyed to the customers view.
CREATE TABLE IF NOT EXISTS "party_contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "party_id" uuid NOT NULL REFERENCES "parties"("id") ON DELETE cascade,
  "name" varchar(128) NOT NULL,
  "role" varchar(16) DEFAULT 'other' NOT NULL,
  "email" varchar(255),
  "phone" varchar(64),
  "is_primary" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "party_contacts_party_idx" ON "party_contacts" ("org_id", "party_id");
--> statement-breakpoint
-- One primary contact per party: the database settles two concurrent saves.
CREATE UNIQUE INDEX IF NOT EXISTS "party_contacts_primary_uq" ON "party_contacts" ("party_id") WHERE "is_primary";
