-- EDI foundation, customer delivery addresses (docs/prd-edi.md Phase 0 item 1, "customer ship-to locations").
-- ADDITIVE: one new table and one nullable column. Nothing is back-filled: a customer with no delivery address
-- behaves exactly as before.
--
-- A customer can have several delivery points (a head office and three stores, two distribution centres). Their
-- EDI order names one (N1*ST, by GLN or by their own location code), so each is a row with a structured address,
-- an ISO country code and optional GLN, the same fields stock_locations gained in 0139.
CREATE TABLE IF NOT EXISTS "party_ship_to" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "party_id" uuid NOT NULL REFERENCES "parties"("id") ON DELETE cascade,
  "name" varchar(128) NOT NULL,
  "code" varchar(32),
  "address_street" varchar(255),
  "address_line2" varchar(255),
  "address_city" varchar(128),
  "address_state" varchar(128),
  "address_postcode" varchar(32),
  "country_code" varchar(2),
  "gln" varchar(13),
  "contact_name" varchar(128),
  "contact_phone" varchar(64),
  "is_default" boolean DEFAULT false NOT NULL,
  "status" varchar(16) DEFAULT 'Active' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "party_ship_to_party_idx" ON "party_ship_to" ("org_id", "party_id");
--> statement-breakpoint
-- One default delivery address per customer: the index, not application logic, settles two concurrent saves.
CREATE UNIQUE INDEX IF NOT EXISTS "party_ship_to_default_uq" ON "party_ship_to" ("party_id") WHERE "is_default";
--> statement-breakpoint
-- The customer's own location code names ONE place (case-insensitive), or an inbound order could not be routed.
CREATE UNIQUE INDEX IF NOT EXISTS "party_ship_to_code_uq" ON "party_ship_to" ("party_id", upper("code")) WHERE "code" IS NOT NULL;
--> statement-breakpoint
-- A GLN names one physical place: one row per customer for it.
CREATE UNIQUE INDEX IF NOT EXISTS "party_ship_to_gln_uq" ON "party_ship_to" ("party_id", "gln") WHERE "gln" IS NOT NULL;
--> statement-breakpoint
-- A Sales Order names where it is delivered. Null = no delivery address chosen (every earlier SO).
ALTER TABLE "trade_documents" ADD COLUMN IF NOT EXISTS "customer_ship_to_id" uuid REFERENCES "party_ship_to"("id") ON DELETE set null;
