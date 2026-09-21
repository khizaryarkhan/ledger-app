# Accounting + Supply Chain — Completion Plan

- **Purpose:** Take both modules from MVP to complete and usable for a manufacturing business.
- **Status:** Proposal for approval. No code changes implied by this document.
- **Audience:** Product owner and whoever implements it.
- **Scope decisions (confirmed 2026-09-21):** native books of record · multiple physical stock locations, needed now · production runs in batches over days with scrap · actual specific-lot costing
- **Out of scope:** Receivables, Payables, Studio, Resources, Reporting, mobile. The QuickBooks→GL ingestion (native books means it is not a blocker here).
- **Last verified against:** commit `3eec3df` (2026-09-17)

## The shape of the problem

Both modules model **the perfect factory**. The happy path is complete and well
built: PO → Goods Receipt → Bill with GR/IR clearing; SO → Shipment → Invoice
with COGS at shipment; FIFO lot valuation with genealogy; job work proven
end-to-end on a 100k-unit textile scenario where the clearing account nets to
exactly zero.

Every material gap is in the same category: **correction, variation and
planning.** Nothing exists for the case where reality does not match the plan —
stock is miscounted, a batch is scrapped, material is consumed at a different
rate than the BOM says, goods come back, or stock sits in more than one place.

That is why the sequence below leads with corrections rather than features.

## Evidence for each gap

| Gap | Evidence |
|---|---|
| No stock adjustment / physical count | `ADJ-` declared in `lib/accounting/numbering.ts`; `adjustment` present in `inventory_lots.sourceType` and `inventory_movements.movementType`; **no API route, no UI, no posting path** |
| MO completion is all-or-nothing | `completeMO` (`lib/inventory/manufacturing-orders.ts:169`) runs one `buildProductionMulti` at full BOM quantity, then sets status Completed |
| No scrap or reject capture | No `scrap`/`wastage`/`reject` reference anywhere in `lib/`, `db/schema.ts` or `app/api/` |
| No material reservation | Noted in `CLAUDE.md` as designed-for, not built |
| Stock is single-location | `inventory_lots` and `inventory_movements` carry **no location column**; `location_id` appears only on `journal_lines` and `trade_document_lines` as a GL dimension |
| No returns moving stock | `CLAUDE.md`: "Credit notes / vendor credits (returns) don't move stock yet" |
| UoM conversion unused on posting lines | `lib/inventory/uom.ts` imported in only 3 files — `supplier-skus` route, `new-document-form.tsx`, `products-register.tsx`; none is a posting path |
| No fixed assets / depreciation | Zero references |
| No budgets, no recurring journals | Only hits are batch-job budgets and Stripe recurring billing |
| No WIP valuation | `WorkInProgress` item kind exists; nothing values a partially-built order at period close |
| No landed cost | Zero references |
| No reorder points / MRP / QC | Zero references |

---

## Phase 1 — Stock locations

**Do this first.** It touches every inventory table and every receipt and issue
path. Retrofitting it after the other phases means reworking all of them.

### Design

Keep the lot as the **cost layer and identity**; add location as a **physical
overlay**. This preserves FIFO costing, lot genealogy and the org-wide unique
lot number exactly as they are today.

```
stock_locations          id, org_id, code, name, type, parent_id, is_default, status
                         type: Store | WIP | FinishedGoods | Transit | Quarantine

inventory_lot_locations  org_id, lot_id, location_id, qty
                         where a lot's remaining quantity physically sits

inventory_movements      + from_location_id, + to_location_id
```

`parent_id` on `stock_locations` leaves room for bin-level detail later without
a second migration.

### Work

1. Migration: `stock_locations`, `inventory_lot_locations`, two columns on `inventory_movements`. Backfill every existing lot into a single default location per org.
2. `lib/inventory/valuation.ts` — `commitReceipt` takes a location; `planIssue`/`commitIssue` relieve from a location; `recalcItemCache` gains a per-location breakdown.
3. Every posting path that moves stock takes a location: `receiving.ts`, `shipping.ts`, `production.ts`, `jobwork.ts`, and the tracked-item branches in `lib/accounting/documents.ts`.
4. **New document type: Stock Transfer.** Moves quantity between locations. No profit-and-loss effect. If two locations map to different inventory accounts it posts Dr/Cr between them; otherwise it is a movement record only.
5. UI: Locations master under Supply Chain → Setup; location pickers on the receiving, shipping and build consoles; Stock Status report grouped by location.
6. **Reconciliation check:** `inventory_lots.remaining_qty` must equal the sum of that lot's `inventory_lot_locations.qty`. Add it to `lib/accounting/reconcile.ts` so drift is provable, not discovered.

**Done when:** stock can be received into one location, transferred to another, and issued from a third, and the Stock Status report and the GL agree.

---

## Phase 2 — Corrections: make book stock match reality

Until book stock can be corrected, nothing downstream means anything. Inventory
on the balance sheet is only as good as this phase.

### 2a. Stock adjustment and physical count

- `stock_adjustments` + `stock_adjustment_lines`, drawing on the already-declared `ADJ-` series.
- **Count sheet workflow:** snapshot expected quantity per item/SKU/lot/location → enter counted quantity → review variance → post.
- Posting: Dr or Cr Inventory against a new **Inventory Adjustment** system account (add to `SYSTEM_ACCOUNTS`, resolved by subtype — created on demand, following the Suspense precedent so it does not appear in every org's chart).
- A write-down adjusts the lot's `remaining_qty`; a write-up creates a new lot at a stated cost, because a found unit has no cost history.

### 2b. Returns

- **Purchase return:** relieve the lot, Dr supplier / vendor credit, Cr Inventory. Links to the originating goods receipt through `transaction_links`.
- **Sales return:** receive stock back at its original COGS, Dr Inventory / Cr COGS, attached to the credit note.
- Both use the existing `transaction_links` graph, so the Linked Transactions panel picks them up with no extra work.

### 2c. UoM conversion on posting lines

Apply `lib/inventory/uom.ts`'s `convert()` in `lib/accounting/documents.ts` and
on BOM lines, so a line can be entered in a purchase, stock or consumption unit
and stored in base UoM. The converter already handles dimensions and conversion
factors — this is wiring, not new logic.

**Done when:** a counted discrepancy, a returned delivery and a kg-to-metre
consumption all post correctly and survive the reconciliation harness.

---

## Phase 3 — Production as it actually runs

The largest behavioural change. An MO stops being a single button and becomes an
order that is worked against over time.

### Design

Introduce a real **WIP stage**, which falls out naturally from partial
completion:

| Event | Posting |
|---|---|
| Issue material to an MO | Dr Work in Progress / Cr Raw Material Inventory, at actual picked-lot cost |
| Receive output from a batch | Dr Finished Goods Inventory / Cr WIP, at accumulated actual cost |
| Record scrap | Dr Scrap & Wastage (P&L) / Cr WIP |
| Close the MO | Any residual WIP variance to a Production Variance account |

This is the correct manufacturing model and it is what makes period-end WIP
valuation possible at all.

### Work

1. **Material issue against an MO** — a separate step from completion, picking specific lots. The valuation engine already supports specific-lot picking; this surfaces it per batch.
2. **Partial production receipts.** `production_runs` already carries `moId`, so a batch is just another run against the order. `manufacturingOrders.productionRunId` (singular, "the build that fulfilled it") is replaced by derived totals.
3. **MO gains** `issuedQty`, `producedQty`, `scrappedQty`; status moves to Completed only when the operator closes it, not automatically at BOM quantity. Over- and under-production both allowed and visible.
4. **Scrap capture** on each receipt, with a reason code, posting to a new Scrap & Wastage system account.
5. **Material reservation.** Reserve stock against a released MO so two orders cannot plan the same lot. Computed reservation, held against lots, released on issue or cancellation.
6. **Actual vs BOM variance report** — what the recipe said versus what was consumed, by order and by item.
7. **WIP valuation at period end** — value open MOs from issued-minus-received WIP, and surface it on the balance sheet.

**Done when:** a 100k-unit order can be released, issued in batches over three
weeks with recorded scrap, produce more or less than the BOM predicted, and close
with WIP at zero and a variance that reconciles.

---

## Phase 4 — Accounting completeness

- **Fixed assets and depreciation** — asset register, method, schedule, monthly posting run. A manufacturer has machines and there is currently nothing.
- **Recurring journals** — depreciation, accruals, prepayments, rent. A template plus a scheduled posting run.
- **Landed cost** — capitalise freight and duty into lot cost on a goods receipt, rather than expensing it. Directly affects margin accuracy for an importer.
- **Budgets and budget-versus-actual** on the P&L.

## Phase 5 — Planning

- **Reorder points, safety stock, min/max** per item and location.
- **MRP** — net demand (open SOs and MOs) against supply (on hand, open POs, open MOs) and suggest what to buy or build. Every input already exists; this is the netting engine and its screen.
- **QC / inspection** on goods receipt — receive into Quarantine, inspect, then release to Store or return. The `Quarantine` location type in Phase 1 exists for this.

---

## Sequencing rationale

1. **Locations first** because it is the only change that gets materially more expensive the longer it waits.
2. **Corrections second** because inventory value is not trustworthy until stock can be counted and corrected, and every later phase reports on that value.
3. **Production third** because partial completion is what creates WIP, and WIP is what Phase 4's period-end valuation needs.
4. **Accounting completeness and planning last** — both are additive and neither blocks the others.

## Invariants to preserve throughout

Carried from `CLAUDE.md` and the existing design; none of this work may weaken them.

- `postJournalEntry` stays the single GL writer. Entries remain immutable and reversal-only.
- No database transactions — plan read-only, then commit, then recalculate the cache.
- Money stays `numeric(14,2)`; never `real()`.
- Dates stay `YYYY-MM-DD` strings, rendered through `lib/format.ts`.
- Every new API route calls `requireOrg()` and `requireModule(orgId, "manufacturing")` where it is manufacturing-only.
- Floor staff (`company_user`) may post physical movements — receipts, issues, transfers, builds, counts. Turning any of them into a money document stays admin-only.
- Every phase extends `lib/accounting/reconcile.ts` with a check that proves its own invariant, and adds unit tests for the pure logic.
- New forms compose from `components/form-kit.tsx`; new nav entries go in a **named** group.

## Open questions before Phase 3

1. **Scrap valuation** — is scrapped material written off entirely, or does recoverable waste (yarn ends, fabric offcuts) re-enter stock as a by-product at a nominal value?
2. **Rework** — can rejected output be fed back into production as input, or is it always scrap?
3. **Co-products** — `production_outputs` already supports several outputs per build with allocated cost. Is that in use, and how should cost be split between them?
