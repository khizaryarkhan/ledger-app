-- The supplier's own name for the product, kept apart from ours.
--
-- A supplier link had one name field, sku_name. For a few days the drawer
-- labelled it "Their product name", so it was being asked to be two things:
-- what WE call this sourced SKU (the name our buyers search and pick) and what
-- the SUPPLIER calls it (what appears on their invoice and price list, which is
-- how a bill line is matched back). Different people read those two, and they
-- rarely agree, so they are two columns. sku_name stays the internal name.
ALTER TABLE "item_supplier_skus" ADD COLUMN IF NOT EXISTS "supplier_product_name" varchar(255);
