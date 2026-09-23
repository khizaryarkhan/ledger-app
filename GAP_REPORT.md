# Inventory Accounting — Gap Report (Phase 1)

**Status:** Phase 1, read-only. No application code has been changed. Awaiting approval before Phase 2.
**Date:** 2026-09-24 · **Codebase:** `ledger-app` @ `main` (`27e18a3`)
**Method:** code investigation with file/line references (§A), a code-level trace of the Acceptance Scenario against current posting logic (§B), and read-only queries against the production database (`ep-royal-rice-abr9rxnv`, SELECT only) for historic impact (§C).

> **About the trace (§B).** There is no disposable tenant or database branch available to this session with an up-to-date schema (the only non-production branch, `vercel-dev`, is ~10 migrations behind), and writing a test tenant into production is not acceptable. The journal trace is therefore derived by following each step through the exact posting functions that would run, with file references. The expected-vs-actual differences are structural (which accounts exist and which functions post), not arithmetic edge cases, so the conclusions do not depend on execution. Phase 2 will add an executable harness for the scenario (§4 deliverables).

---

## Summary

| | |
|---|---|
| **Account model** | 14 **system accounts resolved by QBO subtype**, not roles. One *Inventory Asset* (1200) for every stock item type, one *COGS* (5000). No WIP, PPV, variance, scrap, write-down, returns, or split revenue accounts. No posting groups. Item-level account fields are free choice, unvalidated server-side. |
| **Order accounting** | **No WIP / open-orders account.** A production build posts output and consumption as one instant entry; an MO moves nothing until it is completed. Job work uses a *Materials with Job Worker* clearing account. |
| **Lot costing** | Specific-lot cost is used for consumption **but the lot is never really selected**: FIFO by receipt date everywhere; the one lot grid (single build) keeps the lot ids but **discards the per-lot quantities**. No FEFO. Suggested/selected lot not stored. Lot cost never changes after receipt (no price variance, landed cost or write-down). |
| **Missing events** | Supplier price difference, landed cost, component return, scrap beyond yield, order close variance, customer return to stock, stock count, write-down — **none exist**. |
| **Controls** | Manual journals to inventory accounts **allowed**; item account types **not validated**; **no stock-vs-GL reconciliation**. |
| **Historic impact** | Only **AM MERCHADISING** has native inventory postings. Its GL inventory is **€20,180.01 higher than its stock**, fully explained: a PO converted straight to a Bill (**€20,000.00** double-counted), a receipt line posted without a lot (**€180.00**), rounding (€0.01). |
| **External GL** | 5 of 6 tenants are QBO/Xero-synced. **The app never pushes journals or accounts to QBO/Xero**, and the account sync omits the account types this design needs (§D-4). |

---

## A. Gap table

Severity: **Critical** = wrong financial statements · **High** = missing control or data model · **Medium** = UI / validation · **Low** = naming.

### R-01 · Account roles

| Req | Requirement | Current behaviour (file refs) | Gap | Sev | Proposed change |
|---|---|---|---|---|---|
| R-01 | Posting never references accounts directly; resolves a **role** via the item's posting group | Accounts are resolved three ways: (1) **system account by QBO subtype** — `systemAccountId()` returns the *first* case-insensitive subtype match in the org, including user-created accounts (`lib/accounting/system-accounts.ts:92-97`, `INV_SUBTYPE` `:100`); (2) **item fields** `assetAccountId`/`cogsAccountId`/`incomeAccountId`/`expenseAccountId` (`lib/accounting/documents.ts:178-188`, `:302-303`; `lib/inventory/receiving.ts:102`; `lib/inventory/shipping.ts:112-113`; `lib/inventory/production.ts:65,85,229,256`); (3) **caller-supplied** `accountId` (`documents.ts:180,186`; `trade-documents.ts:215`; PO lines carry the item's account from the form, `components/new-document-form.tsx:441-447`). `controlAccounts` falls back from subtype to type, so COGS can land on *Inventory Adjustments* (same type) (`documents.ts:121`). | No role concept; 18 roles absent; ambiguous subtype resolution | **High** | `account_role` enum + `resolveRole(orgId, item, role)` as the single resolver; every poster (documents, receiving, shipping, production, MO, job work, transfers, write-down, count) calls it. Architecture test forbids direct account/field references in posters. |

### R-02 · System default accounts

| Req | Requirement | Current behaviour | Gap | Sev | Proposed change |
|---|---|---|---|---|---|
| R-02a | 18 default accounts + *Inventories* header, `is_system_default` + `default_role` | `SYSTEM_ACCOUNTS` has 14 (A/R 1100, A/P 2000, Undeposited 1150, Sales Tax 2200, OBE 3000, RE 3900, Uncategorised Income 4999 / Expense 6999, FX 6950, **Inventory Asset 1200, COGS 5000, Inventory Adjustments 5900, GR/IR 2150, Materials with Job Worker 1250**) (`system-accounts.ts:16-44`). Of the 18 required, only GR/IR and Inventory Adjustments have an equivalent. `isSystem` flag exists (`db/schema.ts:1817`); no `default_role`. | 16 accounts missing; no header / non-posting concept (`parentId` exists but is never written, `schema.ts:1814`) | **High** | Add `default_role` + `is_header` columns; seed per §2.2 with blank codes; *Inventories* header. Existing 1200/5000/2150/5900 are adopted, not duplicated (see R-10). |
| R-02b | Blank codes; rename/renumber allowed; type change blocked | System accounts are seeded **with codes** (1200 etc.). Rename/renumber allowed via API (`app/api/accounting/[entity]/[id]/route.ts:88-89`); type change blocked for `isSystem` (`:92`). **Probable UI bug:** the edit modal sends `classification`/`isSystem`/`syncToken` into a `.strict()` schema, so account edits from the UI likely fail (`app/(app)/settings/accounting/_lists.tsx:178-190` vs route `:35`) — unverified by execution. | Codes pre-set; UI edit likely broken | Medium | Seed new defaults with blank codes (existing ones keep theirs); fix the edit payload. |
| R-02c | Cannot delete while a role/group points at it | **No delete exists for any account** (no DELETE handler; `[entity]/[id]/route.ts` exports PATCH only). Non-system accounts can be **deactivated or re-typed** even when items reference them (`:90-99`). | Deactivate/re-type while referenced is allowed | Medium | Block deactivate / type change while referenced by a role, posting group, item override or location. |
| R-02d | Inventory role accounts are **control accounts**: manual journals rejected | Manual journal accepts any active account; only A/R and A/P require a party (`app/api/ledger/journal/route.ts:66-103`, `:80-85`); `validateEntry` has no account restriction (`lib/ledger.ts:69-110`). Opening balances also post to Inventory with no lots (`lib/accounting/opening-balances.ts:30-69`). Any org member may post a manual journal (no role gate, `journal/route.ts:67`). | Not enforced | **High** | `isControlAccount()` check in `postJournalEntry` for `sourceType ∈ {Manual, OpeningBalance}` against inventory-role accounts; opening stock goes through a stock opening-balance flow that creates lots. |

### R-03 · Provisioning and onboarding

| Req | Requirement | Current behaviour | Gap | Sev | Proposed change |
|---|---|---|---|---|---|
| R-03a | Seed defaults + 3 posting groups at provisioning | Tenant creation inserts only org + admin + subscription (`app/api/register/complete/route.ts:112-148`, `app/api/webhooks/stripe/route.ts:121-125`, `app/api/admin/organisations/route.ts:87-103`). System accounts are created **lazily** on first use by ~20 call sites (`ensureSystemAccounts`, `system-accounts.ts:110-133`). The standard COA is seeded only when an admin clicks "set up accounts" (`app/api/accounts/seed/route.ts:15-43`). | No provisioning step | High | `provisionInventoryAccounting(orgId)` at org creation for non-synced tenants; lazy `ensureSystemAccounts` kept for the non-inventory control accounts only. |
| R-03b | Synced tenants: map roles to external accounts, "Create from default" in the external GL | **The app never writes accounts or journals to QBO/Xero** (`lib/ledger.ts:56-59,160-162` only stores external ids for mirrored entries; the only QBO writer is the Batch module, `lib/batch/commit-one.ts:132`). The account sync **omits** Other Current Asset, Other Current Liability, Income and Bank types (QBO `lib/qbo-ap-sync.ts:362`; Xero `lib/xero-ap-sync.ts:396-405`), so the external Inventory, GRNI and Sales accounts are not even available to map. | No mapping step; required accounts not synced; no external create | **High** | See **§D-4** (decision needed). Minimum: extend the account sync to all account types; mapping screen per role. |
| R-03c | Block inventory transactions until every role is mapped | No such check anywhere. | Missing | High | `requireInventoryMapping(orgId, groupIds)` guard in every inventory poster, returning a message that links to the mapping screen. |
| R-03d | Versioned seed template | None. | Missing | Low | `inventory_accounting_templates(version, payload)` + `organisations.inventory_template_version`. |

### R-04 · Inventory Posting Groups

| Req | Requirement | Current behaviour | Gap | Sev | Proposed change |
|---|---|---|---|---|---|
| R-04a | `inventory_posting_group` per tenant, item type, role → account map | Nothing like it: no org-level account settings (`organisations`, `db/schema.ts:7-73`); only per-item fields and a per-location `inventory_account_id` override (`schema.ts:1991`). | Missing entity | **High** | New tables `inventory_posting_groups` and `posting_group_accounts(group_id, role, account_id)`; three seeded groups. |
| R-04b | Category becomes a **mandatory Posting Group** | `apItems.category` is free text, display/search only, never used in posting (`schema.ts:1860`; `products-register.tsx:864,988`). | Missing | High | Add `apItems.posting_group_id` (NOT NULL after migration); keep `category` as a plain descriptive field (it is used in reports and search). |
| R-04c | Item type must match group type | Item kinds are **six**, not three: FinishedProduct, StockItem, RawMaterial, WorkInProgress, NonInventory, Service (`lib/inventory/item-kinds.ts:33-40`). | Type model differs | High | See **§D-2** (StockItem). |
| R-04d | Group resolution rules (movement = item's group; order accounts = output item's group; sales = sold item's group) | Not applicable today. | Missing | High | Implemented in `resolveRole`. |

### R-05 · Posting Matrix

| Req | Event | Current behaviour (file refs) | Gap | Sev | Proposed change |
|---|---|---|---|---|---|
| P-01 | Receive against PO | Goods receipt: Dr item asset (default Inventory Asset) / Cr GR/IR at the **caller's** unit cost (`receiving.ts:106-117`), lot created (`:146-152`). No tie of unit cost to the PO price. No `buyable` / sourcing check on receipts (deliberate, `CLAUDE.md` sourcing section). | Single inventory account; cost not tied to PO; **lot creation error swallowed after the GL posts** (`receiving.ts:152`) — see §C (GRN-0035) | **Critical** | Role `RM/WIP_STOCK/FG_INVENTORY` of item's group; default unit cost from PO line; lot creation failure aborts before posting (plan → validate → post). |
| P-02 | Invoice matched, same price | `billFromReceipts`: Dr GR/IR / Cr A/P at accrued cost (`receiving.ts:193-255`). **No currency is passed**, so foreign-currency receipts cannot be billed (`receiving.ts:225-231` vs `documents.ts:559-561`). | FX receipts unbillable | High | Pass supplier currency + rate; FX difference to existing FX account. |
| P-03 | Invoice price differs | **No mechanism.** `billFromReceipts` cannot take a different price (`BillFromReceiptsInput`, `receiving.ts:177-184`); a manual Bill to GR/IR leaves a residual; lot cost never changes (`valuation.ts:304`, the only writes to `inventory_lots` touch qty/status, `:336-339,442-444`). | Missing | **Critical** | Bill-from-receipt accepts invoice price per line; difference split by `remaining_qty/orig_qty` → lot cost (via `revalueLot`) and `PURCHASE_PRICE_VARIANCE`. |
| P-03' | **PO converted directly to Bill** | `convertTradeDocument` posts Dr the PO line's account (**Inventory** for stock items) / Cr A/P with **no `itemId`/qty**, so **no lot**, and **no check against goods receipts** (`trade-documents.ts:182-242`, `:215`). Receiving the PO *and* converting it counts inventory twice and leaves GR/IR uncleared. **Occurred in production** (§C). | Double-count / stock without lots | **Critical** | For PurchaseOrders: conversion allowed only for non-stock lines; stock lines must go Receive → Bill-from-receipt. A PO with receipts refuses direct conversion of received lines. |
| P-04 | Issue component to MO / work order | **No WIP.** Build: Dr output inventory / Cr input inventory in one entry, status `Completed` immediately (`production.ts:88-100`, `:113`; multi `:242-274`). MO statuses post nothing; consumption and output both happen in `completeMO` (`manufacturing-orders.ts:149-189`). Job work: Dr *Materials with Job Worker* / Cr inventory (`jobwork.ts:135-138`). Consumption is **never** posted to COGS (good). | No WIP_OPEN_ORDERS; MO has no issue step | **Critical** (for MOs spanning a period end: open-order value is invisible) | MO/work-order issue posts Dr `WIP_OPEN_ORDERS` / Cr component role at picked lot cost; quick builds post issue + output through WIP (nets to zero). |
| P-05 | Return unused component | Not supported; only void of the whole run (`lib/inventory/void.ts:85-104`). | Missing | High | `returnComponent(orderId, lotId, qty)` → back to original lot. |
| P-06 | Labour / overhead | **No work centres, labour or overhead rates anywhere** (only unrelated COA subtype labels). | Not built (per spec: record only) | — (recorded) | Not implemented in this task (spec 2.5). Output cost = materials + subcontract. |
| P-07 | Subcontract service received | Job-work receipt credits GR/IR for the fee **and books the output lot in the same entry**: Dr received item (material + fee) / Cr 1250 (material) / Cr GR/IR (fee) (`jobwork.ts:243-245`). Fee is typed in (`:239`). | Service receipt and output not separate; no WIP | High | Split: P-07 Dr `WIP_OPEN_ORDERS` / Cr `GRNI`; P-09 output separately. |
| P-08 | Subcontract invoice | `billFromReceipts` at accrued fee only; a different invoice amount cannot be booked (`receiving.ts:218-220`). | No variance route | High | Same as P-03; to `PRODUCTION_VARIANCE` when the order is closed. |
| P-09 | Report output | Output lot cost = order cost ÷ output qty (`production.ts:146`; job work `jobwork.ts:253`). One build per MO; partial output impossible (`manufacturing-orders.ts:186-187`). Multi-output SKUs get a blended ingredient rate (`production.ts:231-265`). **Issue/output lot commits swallow errors after the GL posts** (`production.ts:123,151,287,299`). | No WIP credit; partial output not possible; swallowed errors | **Critical** (swallowed errors) | P-09 Dr output role / Cr `WIP_OPEN_ORDERS`; partial output; all output lots of an order share the unit cost; commit failures abort. |
| P-10 | Scrap beyond BOM yield | `boms.expYield` stored but **never read** (`schema.ts:2161`; not used by `manufacturing-orders.ts:57-64` or `production.ts:202-209`). Job work `expectedYieldPct` "informational only" (`jobwork.ts:69`). | Missing | High | Yield-aware planned qty; excess loss → `SCRAP_LOSS`. |
| P-11 | Close order residual | No close step for builds/MOs (nothing is ever open). Job work close posts wastage from **quantities**, not the actual clearing balance, with 2-dp quantity rounding (`jobwork.ts:320-322,229,288`) and dates it today (`:347`). | Missing / imprecise | High | Close posts the actual `WIP_OPEN_ORDERS` balance of the order to `PRODUCTION_VARIANCE`; asserts zero after. |
| P-12 | Ship / invoice FP | Shipment: Dr item COGS (default 5000) / Cr item asset at FIFO; invoice-from-shipment Dr A/R / Cr item `incomeAccountId` (required) (`shipping.ts:112-131,224`). Direct invoice: same COGS; **skips zero-cost lots** (`documents.ts:301`) and **silently drops the revenue line when an item has no income account while still posting COGS and the stock issue** (`documents.ts:193` vs `:287`). | Single COGS; revenue-drop defect | **Critical** | `COGS_FG` / `SALES_FG` from the FP group; income role always resolvable; no silent line drop. |
| P-13 | Ship / invoice RM or WIP | Same paths; RM/WIP have **no income account** (never defaulted, hidden in the form, `products-register.tsx:886`) → shipment refuses, direct invoice drops revenue (above). | Wrong or blocked | **Critical** | `COGS_SURPLUS` / `SALES_SURPLUS` by group. |
| P-14 | Customer return to stock | Credit Note / Refund Receipt move **no stock and reverse no COGS** (`SALES_STOCK` = Invoice, SalesReceipt only, `documents.ts:260`). **Vendor Credit on a tracked item credits Inventory but relieves no lot** (`documents.ts:185` vs `PURCH_STOCK` `:261`). | Missing / GL without stock | **Critical** | Credit note with return-to-stock lines → original lot at current cost, `SALES_RETURNS`; vendor credit relieves the returned lot. |
| P-15 | Stock count | **No stock count or adjustment feature** (only unused enum values / an `ADJ-` series, `schema.ts:2016,2074`; `numbering.ts:54`). | Missing | High | Count sheet → per-lot adjustment at lot cost → `INVENTORY_ADJUSTMENT`. |
| P-16 | Write-down | **None.** Lot `unit_cost` is immutable after receipt. | Missing | High | Lot write-down with reason code; lot cost = written-down value ÷ qty. |
| P-17 | Scrap sale (non-stock) | NonInventory sale posts Dr A/R / Cr its income account, no COGS (works). No `SCRAP_SALES` account. | Account only | Low | Default Scrap item mapped to `SCRAP_SALES`. |
| P-18 | Transfer between locations | Placements only; posts **only** if the two locations map to different inventory accounts (`lib/inventory/transfers.ts:112-146`). | Matches (no journal) | Low | Remove the per-location inventory-account posting, or keep as a location-level override of the group role (see R-04). |
| P-rule | Selling from an open order blocked | No reservation or allocation anywhere; an MO holds no stock until completion, so components a released MO needs can be sold (`valuation.ts:137-` takes every Open lot). Output cannot be sold before completion only because it does not exist yet. | Partially satisfied by accident | Medium | Issued components sit in WIP (not sellable); output sellable only after P-09. |
| P-rule | Shortfall consumption | When no location is named, an issue larger than stock is **allowed**, the shortfall is costed at the typed `apItems.unitCost` (or last lot cost) with no lot (`valuation.ts:180-200`), and credited to the GL — GL and stock drift. MO completion never passes a location, so MOs always take this path (`manufacturing-orders.ts:178-182`). | Stock can go negative in the GL only | **Critical** | Reject any issue beyond available lot quantity. |

### R-06 · Costing (specific identification by lot)

| Req | Requirement | Current behaviour | Gap | Sev | Proposed change |
|---|---|---|---|---|---|
| R-06a | Receipt stores lot unit cost | Yes, 6 dp (`valuation.ts:286-319`). | — | — | — |
| R-06b | Invoice differences / landed cost update lot cost for remaining qty, rest to PPV | None (see P-03). No landed-cost allocation exists. | Missing | **Critical** | `revalueLot` + landed-cost allocation on a receipt. |
| R-06c | Consumption at the **selected** lot's cost | Specific lot cost *is* used per pick (`valuation.ts:166,173`) **but the user does not really select**: FIFO by `receivedDate` everywhere (`valuation.ts:150-152`); the single-build grid sends `lotPicks` but the server keeps only the ids and re-fills oldest-first (`production.ts:80`, `valuation.ts:156-178`), so the user's per-lot quantities are discarded. No lot choice on MO completion, job-work dispatch, shipments or sales documents. Multi-build blends to one per-item rate for allocation (`production.ts:231`). | Selection not honoured | **Critical** | `planIssue` takes explicit `{lotId, qty}` picks and honours them exactly; lot-tracked consumption without picks is rejected (after FEFO pre-fill in the UI). |
| R-06d | FEFO suggestion; store suggested lot, selected lot, user | FIFO only; no FEFO (expiry never used for ordering). Movements store lot, qty, cost, `createdBy` (`valuation.ts:366-373`); **suggested vs selected is not stored**. | Missing | High | `suggestLots()` FEFO; `inventory_movements.suggested_lot_id`, `selected_by`. |
| R-06e | Returns to original lot | Not supported (P-05, P-14). | Missing | High | As P-05 / P-14. |
| R-06f | Output lot cost = order cost ÷ good output; all output lots equal; late costs → variance | Single output correct (`production.ts:146`); multi-output SKUs get *different* unit costs by design (packaging per SKU, `production.ts:258-265`); no late-cost path. | Partial | Medium | Equal unit cost across an order's output lots; late costs to `PRODUCTION_VARIANCE` on close. |
| R-06g | Non-lot-tracked: moving weighted average | **No average costing exists.** Every tracked kind is FIFO-lot costed whatever `lotTracked` says (`valuation.ts:55`, `:281-285`); `lotTracked` only controls whether a lot-number field is shown. | Differs | — | See **§D-1**. |
| R-06h | Never value from a typed field | Typed `apItems.unitCost` **is** used for valuation on shortfall (`valuation.ts:180-200`) and as the build-drawer fallback. | Violated | **Critical** | Removed with the shortfall fix; `unitCost` becomes *Default purchase price* (prefill only). |
| R-06i | Stock valuation = Σ lot qty × lot cost | Yes, cached on `ap_items.inv_value` by `recalcItemCache` (`valuation.ts:65-73`). Reports current-only, no as-at date (`app/api/inventory/reports/route.ts:104-162`). | As-at missing | Medium | As-at valuation from movements. |

### R-07 · Item form

| Req | Requirement | Current behaviour (`components/products-register.tsx`, `lib/inventory/item-kinds.ts`) | Gap | Sev | Proposed change |
|---|---|---|---|---|---|
| R-07a | Mandatory Posting Group, filtered by type | None; free-text Category (`:864,988`). | Missing | High | Group dropdown. |
| R-07b | `Can be sold` / `Can be purchased` per item, defaults by type; documents reject | Flags are **per-kind constants**, not per-item (`item-kinds.ts:33-40`). `buyable` enforced on PO/Bill/Expense (`sourcing.ts:204-211`); **`sellable` deliberately not enforced** (`CLAUDE.md`, item-kinds section). | Not per item; sellable unenforced | Medium | `can_be_sold` / `can_be_purchased` columns defaulted from the kind; enforced on sales and purchase documents and shipments. Note: this **reverses** a recorded decision (scrap RM sales) — resolved by the spec's per-item flag, so it is not listed in §D. |
| R-07c | *Default purchase price* relabel; read-only Stock value panel | "Purchase cost" (`:885`), used for prefill **and** shortfall valuation. No stock-value panel on the item. | Missing | Medium | Relabel; lot panel (qty, unit cost, value). |
| R-07d | Accounting section read-only from group; override only for Finance Admin, type-validated | Free-choice dropdowns: asset account offers **Bank, Fixed Asset, Other Asset** (`:827`), COGS offers **Expense** (`:826`); **no server-side validation** of account type, existence or org (`app/api/inventory/items/route.ts:46-65`, `[id]/route.ts:94-99`). Asset/COGS account can be **changed while stock is on hand**, stranding the GL balance. No Finance Admin permission exists. | Missing control | **High** | Inherited read-only; `finance_admin` permission for overrides; server-side type validation against the role. |
| R-07e | Default sales tax / default purchase tax by flag | One `taxRateId` on the item, shown always (`:921-927`); input and output tax post to the **same** Sales Tax Payable account (`documents.ts:208,237`). | Single field | Medium | Two fields. (Separate input-tax account is outside this spec; flagged, not proposed.) |

### R-08 · Remapping after go-live

| Req | Requirement | Current behaviour | Gap | Sev | Proposed change |
|---|---|---|---|---|---|
| R-08 | Remapping an inventory role with a balance posts a reclass, with confirmation | Changing an item's asset account (or a location's) leaves the old balance behind silently (`items/[id]/route.ts:94-99`). | Missing | High | Remap endpoint computes the role balance, confirms, posts a dated reclass. |

### R-09 · Reconciliation reports

| Req | Requirement | Current behaviour | Gap | Sev | Proposed change |
|---|---|---|---|---|---|
| R-09a | Stock vs GL per posting group, as at a date | **None.** `lib/accounting/reconcile.ts:77-322` has 11 checks (A/R, A/P, lot placements, tenancy…) but none compares stock value to the Inventory GL, nor checks GR/IR or job-work clearing. | Missing | **High** — the defects in §C went unnoticed for this reason | Report + a reconcile check (`inventory_vs_gl`) that fails loudly. |
| R-09b | Open orders vs WIP | No WIP exists. | Missing | High | Report over `WIP_OPEN_ORDERS`. |

### R-10 · Migration of existing tenants

| Req | Requirement | Current state relevant to migration | Gap | Sev | Proposed change |
|---|---|---|---|---|---|
| R-10 | Dry-run migration: defaults, groups, item assignment, override retention, reclass split, no history rewrite | Only **AM MERCHADISING** has native inventory (30 items on *Inventory Asset*; GL inventory €40,422.62 vs stock €20,242.61 — §C). The other 5 tenants are QBO/Xero-synced with no native inventory postings. Synced items are stored as `productType = FinishedProduct` (column default, `schema.ts:1852`) **even when they are QBO Service/NonInventory items**, and their account fields hold raw external ids, not local ids (`qbo-ap-sync.ts:434-435`; `xero-ap-sync.ts:480-481`). | Data preconditions | High | Script `scripts/migrate-inventory-accounting.ts --dry-run`. The reclass must reconcile the GL balance to the **stock valuation**, which today differ by €20,180.01 — see §D-3. Synced items must be re-typed from QBO `Type` before they can be assigned to groups. |

---

## B. Journal trace — Acceptance Scenario vs current code

Accounts available today (seeded): *Inventory Asset 1200*, *COGS 5000*, *Inventory Adjustments 5900*, *GR/IR 2150*, *Materials with Job Worker 1250*, A/R, A/P. Income accounts are per item (none defaulted). "Dye work order" = job work; "Jogger MO" = manufacturing order. Labour rates **do not exist**, so per the scenario step 10 is skipped and the expected FG cost becomes **€360 / €7.20**, making step 12's expected COGS **€144** (not €184).

| Step | Expected | Current (derived from code) | Match |
|---|---|---|---|
| 1 | Dr RM Inventory 500 / Cr GRNI 500 | Goods receipt: **Dr Inventory Asset 500 / Cr GR/IR 500**; lot GF-001 @ 5 (`receiving.ts:106-152`) | Amount ✓ · account ✗ (single inventory) |
| 2 | Dr RM Inventory 300 / Cr GRNI 300 | Dr Inventory Asset 300 / Cr GR/IR 300; GF-002 @ 6 | Amount ✓ · account ✗ |
| 3 | Dr RM Inventory 20 / Cr GRNI 20 | Dr Inventory Asset 20 / Cr GR/IR 20; LB-001 @ 0.20 | Amount ✓ · account ✗ |
| 4 | Dr GRNI 820 / Cr AP 820 | Bill from receipts: Dr GR/IR 820 / Cr A/P 820 (`receiving.ts:193-255`) | ✓ |
| 5 | Dr WIP–Open Orders 500 / Cr RM Inventory 500 (lot cost) | Job-work dispatch, **FIFO** (no lot choice): picks GF-001 because it was received first → **Dr Materials with Job Worker 500 / Cr Inventory Asset 500** (`jobwork.ts:122,135-138`). No suggested/selected lot stored. | Amount ✓ **by coincidence of FIFO** · account ✗ · lot override test ✗ (GF-002 cannot be chosen) |
| 6 | Dr WIP–Open Orders 200 / Cr GRNI 200 | No separate service receipt. Combined with step 7 (below). | ✗ structure |
| 7 | Dr Semi-finished 700 / Cr WIP 700; DF-001 @ 7 | Job-work receipt: **Dr Inventory Asset 700 / Cr Materials with Job Worker 500 / Cr GR/IR 200** in one entry; DF-001 @ 7.00 (`jobwork.ts:238-261`). Close: no wastage → no entry (`jobwork.ts:336`). | Lot cost ✓ · accounts ✗ · steps 6/7 merged |
| 8 | Dr GRNI 200 / Cr AP 200 | Bill from receipts on the fee receipt: Dr GR/IR 200 / Cr A/P 200 | ✓ |
| 9 | Dr WIP 360 / Cr Semi-finished 350, Cr RM 10 | **Nothing posts** at issue — the MO moves no stock until completion (`manufacturing-orders.ts:149-157`). | ✗ (no issue step) |
| 10 | Labour (skipped — no rates) | Skipped | — |
| 11 | Dr FG Inventory 360 / Cr WIP 360; JP-001 @ 7.20 | `completeMO` → one entry: **Dr Inventory Asset 360 / Cr Inventory Asset 350 / Cr Inventory Asset 10** (net 0 on the account); FIFO takes DF-001 and LB-001 (the only lots) → JP-001 @ 7.20 (`production.ts:225-301`). | Lot cost ✓ · no WIP ✗ · single account (no RM/WIP/FG split) |
| 12 | Dr COGS–FG 144 / Cr FG Inventory 144; Dr AR 500 / Cr Sales–FG 500 | Shipment: **Dr COGS 144 / Cr Inventory Asset 144**; invoice from shipment: Dr A/R 500 / Cr the item's income account (required) (`shipping.ts:112-131,224`) | Amounts ✓ · accounts ✗ |
| 13 | Write-down DF-001 by 50 → lot @ 6 | **Not possible** — no write-down feature; lot cost immutable. | ✗ |
| 14 | Dr COGS–Surplus 120 / Cr Semi-finished 120; Dr AR 120 / Cr Sales–Surplus 120 | DF is a WIP item: no income account (never defaulted, hidden in the form). **Shipment refuses** ("income account required"); a **direct invoice posts COGS 140** (at €7, no write-down) **and silently drops the revenue line** (`documents.ts:193` vs `:287`). | ✗ (blocked, or wrong) |
| 15 | Dr COGS–Surplus 2 / Cr RM 2; Dr AR 5 / Cr Sales–Surplus 5 | Same as 14 for an RM item: blocked on shipment; direct invoice posts COGS 2 (correct lot cost) and drops revenue. `sellable` is not enforced server-side, so nothing stops the sale itself. | ✗ |
| 16 | Dr AR 15 / Cr Scrap Sales 15 | NonInventory item: Dr A/R 15 / Cr the item's income account (works; no dedicated Scrap Sales account) | Amount ✓ · account ✗ |
| 17 | Dr Inventory Adjustments 0.40 / Cr RM 0.40 | **Not possible** — no stock count / adjustment. | ✗ |

**End balances (current, if steps 14/15 are done by direct invoice):** one *Inventory Asset* account holding **€734.00** = GF-002 €300 + LB-001 40 × €0.20 = €8 (no count) + DF-001 30 kg × **€7** = €210 (no write-down) + JP-001 30 × €7.20 = €216. Expected (labour skipped): RM €307.60 · Semi-finished €180 · WIP €0 · FG €216 · GRNI €0 — *five balances in four inventory accounts, total €703.60*. GR/IR ends at 0 ✓. Revenue for steps 14–15 is missing from the P&L (€125).

**Negative tests (current):**

| Test | Current | Result |
|---|---|---|
| Manual journal to an inventory control account | Accepted (`journal/route.ts:66-103`) | ✗ not rejected |
| Sell Dyed Fabric from an open MO | Output does not exist until completion; *components* of an open MO can be sold | Partially ✓ (by accident) |
| Sell a Care Label with `Can be sold` off | Accepted server-side (sellable not enforced) | ✗ |
| Map `FG_INVENTORY` to an expense account | No roles; an item's asset account accepts any id, unvalidated | ✗ |
| Delete Raw Materials Inventory while mapped | No account can be deleted at all; system accounts cannot be deactivated | ✓ (trivially) |
| Post inventory with an unmapped role | No roles; system accounts auto-create on first use | ✗ (n/a) |
| Consume a lot-tracked item without selecting a lot | Accepted everywhere (FIFO auto-pick) | ✗ |

**Additional unit tests:** lot override ✗ (server re-fills FIFO), partial lot consumption ✓ (remaining keeps its cost), landed cost ✗, multiple output lots same cost ✗ (per-SKU costs by design), late cost to variance ✗, lot-level write-down ✗, non-lot-tracked average ✗ (no averaging exists), P-05 ✗, P-10 ✗, P-11 partial (job work only), P-14 ✗, R-08 ✗, R-10 dry run ✗.

---

## C. Historic impact (production, read-only; for finance review — nothing corrected)

Queried 2026-09-24 against `ep-royal-rice-abr9rxnv` (SELECT only).

**Tenants with native inventory postings: 1 of 6.** ACC, Aberny, EDC, EDC London and Foodready.ai have no native inventory postings (their books are in QBO/Xero) and are unaffected by the posting defects below.

### AM MERCHADISING

**Inventory GL vs stock:** GL *Inventory Asset* balance **€40,422.62**; open-lot valuation **€20,242.61**; **difference €20,180.01**, fully explained:

| # | Document | What happened | Effect |
|---|---|---|---|
| 1 | **BILL-0004** (2026-09-21, "From purchase order PO-0002", Yarn) | PO-0002 (5,000 × €4.00 = €20,000) was **received** (goods receipt: Dr Inventory 20,000 / Cr GR/IR 20,000, lot created) **and then converted directly to a Bill** (Dr Inventory 20,000 / Cr A/P 20,000, no lot) — defect P-03'. | Inventory **overstated €20,000.00**; GR/IR carries **€20,000.00 that will never clear**; A/P correct (one liability). |
| 2 | **GRN-0035** (2026-09-03), line "Fresh Olives" 60 × €3.00 | GL debited Inventory €180 but **no lot was created** (`lot_id` null; the same receipt's second Fresh Olives line did get a lot). The lot-commit error was swallowed after the GL posted (`receiving.ts:152`). Likely cause: the org-wide unique lot number colliding for two lines of one item — not proven. | Inventory **overstated €180.00**; 60 units recorded in the GL with no stock. |
| 3 | Shipments (3) | Per-line cost rounding: GL −€40,607.68 vs movements −€40,607.69 | €0.01 |

**GR/IR balance −€38,759.50** (credit): receipts €49,710.00 + job-work fees €12,049.50 accrued, €23,000.00 billed from receipts. Of the remainder, **€20,000.00 is item 1** (billed via the PO instead); **€18,759.50** is receipts and job-work fees not yet billed — may be legitimately open; finance to confirm.

**Other checks (no issues found):** manual/opening-balance journals to inventory, GR/IR or job-work accounts: **0**. Stock issues without a lot (shortfall consumption): **0**. Production consumption posted to COGS: **0** (4 production entries, €44,309.00, Dr/Cr Inventory — balanced, not wrong under the current single-account model). Materials with Job Worker balance: **€0.00** (8 orders closed, 3 partially received).

**Structural (not an error in today's model, but material for R-10):** all 30 stock items post to one *Inventory Asset*; the RM / semi-finished / FG split does not exist historically and must be created by the migration reclass.

---

## D. Items needing a decision

Only where current code conflicts with the spec in a way the spec does not resolve.

1. **"Not lot-tracked" items.** The spec assumes some items are not lot-tracked and averages them. In this code **every stock item is lot-costed**; `lotTracked = false` only means the system auto-numbers lots instead of asking for a supplier batch. *Options:* (a) treat all stock items as lot-costed (no averaging; `lotTracked` stays a numbering choice) — **recommended**, no historic cost changes; (b) implement moving average for `lotTracked = false` items, which changes the costing of existing items at migration.

2. **Six item kinds vs three posting-group types.** The code has **Stock Item** (bought and resold, e.g. *Fresh Olives*) plus NonInventory and Service besides RM/WIP/FP. *Options for Stock Item:* (a) FP-type group (sold → `SALES_FG`/`COGS_FG`); (b) a fourth group type "Trading Goods" with the same roles as FP — **recommended**, keeps traded goods out of the finished-goods account. NonInventory/Service have no posting group (non-stock, like the scrap item in P-17).

3. **Migration reclass when GL ≠ stock.** R-10 step 4 splits "the existing Inventory Asset balance" using stock valuation — but for AM MERCHADISING the GL balance is **€20,180.01 higher** than stock (§C). *Options:* (a) reclass only the stock valuation (€20,242.61) into RM/WIP/FG and **leave the €20,180.01 in the old Inventory Asset account** for finance to clear (e.g. reverse BILL-0004's inventory line against GR/IR) — **recommended**, no history rewritten; (b) post a correcting entry as part of the migration (needs finance sign-off per item).

4. **Tenants synced to QuickBooks/Xero (5 of 6).** The app **does not push anything to QBO/Xero**, and our native GL is not their book of record. The spec's "Create from default" in the external GL and the "block until mapped" rule assume a two-way GL link. *Options:* (a) for synced tenants, the inventory roles map to **native** accounts in our GL only (no external create), and inventory accounting stays internal — simplest; (b) extend the account sync to all types and let roles map to **synced** accounts, still without pushing journals; (c) build journal/account push to QBO/Xero (a separate, large project). Also: should the R-03 block apply to synced tenants that do not use native inventory at all? **Recommended:** (b), with the block applying only to tenants that post native inventory transactions.

5. **Materials with Job Worker (1250).** Not in the spec's role list; the spec routes subcontracting through `WIP_OPEN_ORDERS`. *Recommended:* retire 1250 as a role (balance is €0.00 today), keep the account for history; the 3 partially-received job-work orders at migration are re-pointed to `WIP_OPEN_ORDERS` with a reclass of their open value (currently €0.00 because the clearing is at zero).

---

## Also found (outside the spec, recorded for completeness)

- `sellable` is intentionally unenforced today (scrap sales); R-07's per-item flag supersedes that with a switch, so scrap-selling orgs turn *Can be sold* on for those items.
- Input and output tax share one *Sales Tax Payable* account (`documents.ts:208,237`).
- Job-work void can delete a received lot that was already consumed (`valuation.ts:411` guard omits `jobwork_receipt`).
- PO→Bill conversion is dated today (`trade-documents.ts:211`), and job-work close is dated today (`jobwork.ts:347`).
- The QBO sync stores every item as FinishedProduct (tracked) regardless of its QBO type, so a native purchase of a synced *Service* item would capitalise to inventory.

**Awaiting approval of this report, and decisions on §D-1 to §D-5, before Phase 2.**
