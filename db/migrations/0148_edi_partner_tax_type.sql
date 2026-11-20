-- EDI 810: the tax TYPE code a partner expects on TXI01 (the invoice stores only the tax amount, not its kind). ADDITIVE and
-- harmless: every existing partner keeps ZZ (mutually defined), which is exactly what was sent before.
ALTER TABLE "edi_partners" ADD COLUMN IF NOT EXISTS "tax_type" varchar(2) NOT NULL DEFAULT 'ZZ';
