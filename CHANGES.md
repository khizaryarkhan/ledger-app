# Inventory accounting — Phase 2 changes (Chart of Accounts mapping)

Scope agreed with the product owner (2026-09-24): the account-role and
posting-group layer, plus the posting changes it makes possible. Decisions:
`StockItem` is a fourth group type, **Trading goods**. Synced (QBO/Xero)
tenants map roles to any of their own accounts, and nothing is pushed out.
D-1: lot costing stays. D-5: "Materials with Job Worker" is retired in favour
of `WIP_OPEN_ORDERS`.

| ID | Status | What changed | Where |
|---|---|---|---|
| R-01 | Done | An `AccountRole` vocabulary with 18 roles, each with its allowed account types. Every poster resolves roles, never a subtype lookup or item field. | `lib/accounting/account-roles.ts`, `account-roles-server.ts`, `lib/inventory/valuation.ts` (`loadItemCostInfo`) |
| R-02 | Done | Added `is_system_default`, `default_role` and `is_header` to accounts. The 18 defaults, 3 trading defaults and an `Inventories` header are seeded with blank codes. Rename is allowed. Re-typing a system account is blocked. Deactivating or re-typing any account that a role or item uses is blocked. Control accounts refuse hand-entered journals and account lines. Account edit schema changed from `.strict()` to `.strip()`. | `db/migrations/0095_*`, `lib/ledger.ts`, `lib/accounting/documents.ts`, `app/api/accounting/[entity]/[id]/route.ts` |
| R-03 | Done (lazy) | Native charts are provisioned on first use (existing GR/IR, COGS and Adjustments are adopted). Synced charts get groups only, plus a local "Create missing default accounts" action. A tracked item whose group has any unmapped role is blocked from every stock movement. The template carries `TEMPLATE_VERSION`, stored on `organisations.inventory_template_version`. | `account-roles-server.ts` (`provisionInventoryAccounting`, `ensureInventoryAccounting`), `valuation.ts` |
| R-04 | Done | `inventory_posting_groups` and `posting_group_accounts` tables, with 4 default groups (RM / WIP / FP / TRADING). New groups copy the default of their type. `ap_items.posting_group_id`, whose type must match the item's. | schema, `app/api/accounting/posting-groups/**`, `components/posting-groups.tsx` |
| P-01 / P-02 | Done (accounts) | A receipt debits the item group's inventory role and credits the group's GRNI. A bill from a receipt debits the GRNI of each line's item. | `lib/inventory/receiving.ts` |
| P-03' | Done | A PO line for a stocked item can no longer be converted directly to a Bill. | `lib/accounting/trade-documents.ts` |
| P-04 / P-09 | Partial | Builds post components to `WIP_OPEN_ORDERS` and output out of it, netting to zero. There is still no separate issue step for an open MO. | `lib/inventory/production.ts` |
| P-07 / P-11 (job work) | Partial | Job work dispatch, receive and close use `WIP_OPEN_ORDERS`. Wastage goes to `SCRAP_LOSS` and a yield gain to `PRODUCTION_VARIANCE`. | `lib/inventory/jobwork.ts` |
| P-12 / P-13 | Done | Sales use COGS_FG/SALES_FG or COGS_SURPLUS/SALES_SURPLUS depending on the group. RM sold as surplus is no longer refused. | `documents.ts`, `lib/inventory/shipping.ts` |
| P-14 | Partial | A credit note on a stocked item debits `SALES_RETURNS`. Stock does not return to the lot yet. | `documents.ts` |
| P-18 | Done | Transfers post no journal. The per-location inventory account is no longer read. | `lib/inventory/transfers.ts` |
| R-07 (accounting) | Done | Mandatory posting group on the item form (blank = default of type). Inherited accounts are shown read-only. Admins can set type-validated overrides, which the server re-checks. The stock account can't change while the item holds value. "Default purchase price" relabel. | `components/item-accounting.tsx`, `products-register.tsx`, `app/api/inventory/items/**` |
| R-08 | Done | Remapping a stock role shows the reclass and asks for confirmation. On confirm it posts a dated `Reclass` entry, then saves the mapping. | `account-roles-server.ts` (`planReclass`, `updateGroupMapping`) |
| R-09 | Done | A Stock vs GL report per inventory account, with an as-at date. Open job-work value is shown against WIP. Reconcile check `inventory_vs_gl`. | `/accounting/reports/stock-vs-gl`, `lib/accounting/reconcile.ts` |
| R-10 | Done | Migration script, dry run by default. It provisions accounts, assigns groups, reports overrides kept or dropped, and reclasses the old account at stock valuation. The residual is reported, not plugged. Historic journals are never rewritten. | `scripts/migrate-inventory-accounting.ts` |
| R-05 rest, R-06, R-07 flags/tax | Not in this scope | P-03 PPV into lot cost, P-05/P-14 returns to lot, P-10, MO close, P-15/P-16 count and write-down, P-06 (no rates exist), FEFO, per-item sold/purchased flags, separate tax fields. | See GAP_REPORT.md |

Tests: `tests/account-roles.test.ts` (vocabulary) and the new guards in
`tests/architecture.test.ts` (no subtype lookup, no catch-all fallback, block in
`loadItemCostInfo`, control-account refusal, no location account on transfers,
client-safe vocabulary). Each guard was checked against the pre-Phase-2 posters
and fails on them.
