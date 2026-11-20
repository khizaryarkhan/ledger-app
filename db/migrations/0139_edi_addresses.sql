-- EDI foundation, addresses (docs/prd-edi.md Phase 0 item 1). ALL ADDITIVE and nullable: no existing row changes
-- meaning, and nothing is back-filled here (scripts/_backfill_country_codes.ts proposes codes, dry run by default).
--
-- EDI addresses need an ISO 3166-1 alpha-2 country code, never a name, and may need a GLN (GS1 Global Location
-- Number, 13 digits). Country names stay where they are; the code sits beside them.
ALTER TABLE "organisations" ADD COLUMN IF NOT EXISTS "address_country_code" varchar(2), ADD COLUMN IF NOT EXISTS "gln" varchar(13);
--> statement-breakpoint
-- parties: the party's own address country as a code, and its GLN. Written directly to `parties` (the customers /
-- ap_suppliers views are not recreated), the same way lead_time_days is (0114).
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "country_code" varchar(2), ADD COLUMN IF NOT EXISTS "gln" varchar(13);
--> statement-breakpoint
-- countries: the org's own country list (what regions and rep books group by) gains the ISO code its name means, so
-- a party that picks from the list gets a code without a second picker.
ALTER TABLE "countries" ADD COLUMN IF NOT EXISTS "iso_code" varchar(2);
--> statement-breakpoint
-- stock_locations: a structured address (the old free-text `address` stays) plus country code and GLN, so a location
-- can be a ship-to on a purchase order.
ALTER TABLE "stock_locations"
  ADD COLUMN IF NOT EXISTS "address_street" varchar(255),
  ADD COLUMN IF NOT EXISTS "address_line2" varchar(255),
  ADD COLUMN IF NOT EXISTS "address_city" varchar(128),
  ADD COLUMN IF NOT EXISTS "address_state" varchar(128),
  ADD COLUMN IF NOT EXISTS "address_postcode" varchar(32),
  ADD COLUMN IF NOT EXISTS "country_code" varchar(2),
  ADD COLUMN IF NOT EXISTS "gln" varchar(13);
--> statement-breakpoint
-- trade_documents: where a purchase order's goods are to be delivered. Null = the org's default location (resolved at
-- send time), which is what every PO before this meant.
ALTER TABLE "trade_documents" ADD COLUMN IF NOT EXISTS "ship_to_location_id" uuid REFERENCES "stock_locations"("id") ON DELETE SET NULL;
