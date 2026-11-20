-- EDI 856: the carrier's SCAC (standard carrier alpha code, 2-4 letters) beside the free-text carrier name, so TD5 can name the
-- carrier the way a partner's system expects. ADDITIVE and nullable: a shipment with none sends the name only, as before.
ALTER TABLE "sales_shipments" ADD COLUMN IF NOT EXISTS "carrier_scac" varchar(4);
