-- Each group keeps only the accounts something actually posts to for that
-- kind of item (product owner, 2026-09-24): raw material carries no labour,
-- overhead or production variance (it is never the output of an order);
-- semi-finished has no purchase price variance (it is never bought); only
-- finished and trading goods take customer returns; and no group carries
-- Scrap sales (scrap is never stock, its income account belongs on the
-- non-stock scrap item). Generated from rolesForGroupType in
-- lib/accounting/account-roles.ts. The accounts themselves are untouched.
DELETE FROM "posting_group_accounts" pga
USING "inventory_posting_groups" g
WHERE g."id" = pga."group_id"
  AND (
    (g."group_type" = 'RM' AND pga."role" NOT IN ('RM_INVENTORY','WIP_OPEN_ORDERS','GRNI','SALES_SURPLUS','COGS_SURPLUS','PURCHASE_PRICE_VARIANCE','INVENTORY_ADJUSTMENT','INVENTORY_WRITEDOWN'))
        OR (g."group_type" = 'WIP' AND pga."role" NOT IN ('WIP_STOCK','WIP_OPEN_ORDERS','GRNI','SALES_SURPLUS','COGS_SURPLUS','LABOUR_ABSORBED','OVERHEAD_ABSORBED','PRODUCTION_VARIANCE','SCRAP_LOSS','INVENTORY_ADJUSTMENT','INVENTORY_WRITEDOWN'))
        OR (g."group_type" = 'FP' AND pga."role" NOT IN ('WIP_OPEN_ORDERS','FG_INVENTORY','GRNI','SALES_FG','SALES_RETURNS','COGS_FG','LABOUR_ABSORBED','OVERHEAD_ABSORBED','PRODUCTION_VARIANCE','PURCHASE_PRICE_VARIANCE','SCRAP_LOSS','INVENTORY_ADJUSTMENT','INVENTORY_WRITEDOWN'))
        OR (g."group_type" = 'TRADING' AND pga."role" NOT IN ('FG_INVENTORY','GRNI','SALES_FG','SALES_RETURNS','COGS_FG','PURCHASE_PRICE_VARIANCE','INVENTORY_ADJUSTMENT','INVENTORY_WRITEDOWN'))
  );
