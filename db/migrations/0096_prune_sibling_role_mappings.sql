-- A posting group maps only the roles its TYPE posts through: its own stock,
-- sales and cost-of-sales role, plus the shared ones. 0095's first provisioning
-- mapped all 18 on every group, so a Raw Materials group also carried
-- "Finished goods inventory", "Sales – finished goods" and the rest — rows that
-- no posting ever reads, which made the mapping screen look as if accounts
-- were mixed between groups and made remap treat every stock account as shared.
-- See rolesForGroupType in lib/accounting/account-roles.ts; the lists below are
-- the goods roles each type does NOT use.
DELETE FROM "posting_group_accounts" pga
USING "inventory_posting_groups" g
WHERE g."id" = pga."group_id"
  AND (
       (g."group_type" = 'RM'  AND pga."role" IN ('WIP_STOCK','FG_INVENTORY','SALES_FG','COGS_FG'))
    OR (g."group_type" = 'WIP' AND pga."role" IN ('RM_INVENTORY','FG_INVENTORY','SALES_FG','COGS_FG'))
    OR (g."group_type" IN ('FP','TRADING') AND pga."role" IN ('RM_INVENTORY','WIP_STOCK','SALES_SURPLUS','COGS_SURPLUS'))
  );
