-- Scrap is never stock, so it is not a posting-group role. Selling offcuts is
-- invoicing a NON-STOCK item whose income account is Scrap Sales. New tenants
-- get it from provisioning (ensureScrapItem); this gives it to tenants already
-- provisioned. Skipped where an item of that name already exists.
INSERT INTO "ap_items" ("org_id", "source", "name", "product_type", "item_type", "income_account_id", "sourcing_policy", "status", "description")
SELECT a."org_id", 'native', 'Scrap & offcuts', 'NonInventory', 'Non-Inventory', a."id"::text, 'open', 'Active',
       'Scrap and offcuts sold. Not stock: invoicing it credits Scrap Sales, with no cost of sales.'
FROM "accounts" a
WHERE a."default_role" = 'SCRAP_SALES' AND a."is_system_default"
  AND NOT EXISTS (SELECT 1 FROM "ap_items" i WHERE i."org_id" = a."org_id" AND lower(trim(i."name")) = 'scrap & offcuts')
  AND a."id" = (SELECT min(b."id"::text)::uuid FROM "accounts" b WHERE b."org_id" = a."org_id" AND b."default_role" = 'SCRAP_SALES' AND b."is_system_default");
