# Manufacturing operations — end-to-end walkthrough checklist

- **Purpose:** A real accountant's setup-and-run sequence for a manufacturing
  org in Prime Accountax, written as a checklist to be followed literally in
  the app. Each step names the screen/route, the data an accountant would
  actually enter, the accounting effect, and — where relevant — a flag against
  a gap identified in the 2026-10-14 QBO-parity review.
- **Audience:** Whoever is testing the app end-to-end as an accountant would.
  Follow it in order the first time; branch into the "variations" once the
  happy path works.
- **How to use it:** Tick a step, note what broke or felt wrong, move on.
  Don't stop to fix anything mid-walkthrough — collect findings first, fix in
  a batch afterward. A `⚠` marks a step where a known gap (from CLAUDE.md /
  the parity review) will bite; a `?` marks something to verify live because
  it wasn't independently confirmed.

---

## Phase 0 — Org and module setup (do once, before any transaction)

- [ ] **0.1 Confirm modules are enabled.** `/admin/customers/[orgId]` → Modules
  card. For a manufacturing org you need **Accounting** and **Manufacturing**
  ticked (Supply Chain workspace won't appear otherwise). Tick **Resources**
  only if you'll schedule people/equipment against MOs.
- [ ] **0.2 Chart of accounts is provisioned.** Open any inventory screen once
  — `ensureInventoryAccounting` provisions the 18 default roles + Suspense +
  GR/IR lazily on first use. Then go to Accounting → Chart of Accounts and
  confirm you can see: Raw Materials Inventory, WIP Inventory (stock + open
  orders), Finished Goods Inventory, GR/IR Clearing, COGS (FG/Surplus), Sales
  (FG/Surplus), Sales Returns, Purchase Price Variance, Production Variance,
  Scrap & Yield Loss, Materials with Job Worker.
- [ ] **0.3 Posting groups.** Accounting → Inventory posting groups (or the
  item form's group picker). Confirm the four default groups exist — Raw
  Material, WIP, Finished Product, Trading — and that each role resolves to a
  real account. If you operate more than one product line that should hit
  different GL accounts (e.g. textiles vs packaging), create additional
  groups now, before items are created — an item's group is changeable later
  but changing it is a deliberate reclass (R-08), not a free edit.
- [ ] **0.4 Tax rates.** Accounting → Setup → Tax Rates. Set up sales and
  purchase rates separately — items can carry a different default for each
  direction.
- [ ] **0.5 Locations.** Supply Chain → Inventory → Locations. If you run one
  site, the default "MAIN" location is enough and location pickers will stay
  hidden everywhere (by design, below two locations). If you run more than
  one physical store/warehouse/floor, create them now: a Store, a WIP floor,
  a Finished Goods warehouse, and a Quarantine location if you do incoming QC.
- [ ] **0.6 Work centres.** Supply Chain → Manufacturing → Work Centres. Set
  labour rate/hour and overhead rate/hour per centre — this is what a BOM's
  operations draw their cost from. Get this right before building any BOM;
  an MO copies the rate at planning time, so a rate fixed later won't re-cost
  an order already in flight.
- [ ] **0.7 Numbering/series sanity check.** Confirm invoice/PO/MO/GR/shipment
  number series don't collide with anything imported from QBO/Xero if this
  org is also synced.

---

## Phase 1 — Item Register (your Step 1)

This has to be right before anything else, because item kind decides
everything downstream: what account it posts to, whether it can be bought,
sold, or built, and what panels even appear on its form.

- [ ] **1.1 Decide item kind per SKU**, using the actual taxonomy
  (`lib/inventory/item-kinds.ts`): `RawMaterial`, `WorkInProgress`,
  `FinishedProduct`, `StockItem` (buy-and-resell, "Trading"),
  `NonInventory`, `Service`. Get this right first — changing kind later
  changes which accounts, panels and rules apply.
- [ ] **1.2 Create each Raw Material** — Supply Chain → Inventory → Products &
  Materials → New. Set: base UoM, posting group (defaults to Raw Material),
  purchase tax rate, default purchase price, can-be-sold toggle (on if you
  sell scrap/surplus raw material, off otherwise).
- [ ] **1.3 Create each Finished Product** — same screen, kind
  `FinishedProduct`. Set sales price, sales tax rate, can-be-purchased
  toggle (usually off — a finished product is normally only produced, not
  bought; switch on only if you also buy-in finished stock from a third
  party under the same SKU).
- [ ] **1.4 Create Work-in-Progress items** only if your process has a
  distinct semi-finished stage you want to track as its own stock line (e.g.
  grey fabric before dyeing). These are tracked but neither buyable nor
  sellable by default.
- [ ] **1.5 Trading goods** (`StockItem`) — anything you buy and resell
  unchanged. Gets its own stock/sales/COGS roles, separate from Finished
  Product.
- [ ] **1.6 Set up packs and SKU hierarchy.** For any item sold or bought in
  more than one unit level (each / carton / pallet), configure the item's
  SKU pack sizes before you create the first PO/SO — pack-level ordering and
  pricing both key off this.
- [ ] **1.7 Supplier sourcing links** — on each Raw Material / Trading item's
  Suppliers panel, link every vendor you actually buy it from, with their
  SKU, quoted price (at whatever level they quote — unit/inner/outer), and
  lead time. Decide `sourcing_policy`: leave `restricted` (default — only
  linked suppliers may be used on a PO/Bill) unless this is a true commodity
  you'll buy from anyone, in which case switch it to `open`.
  ⚠ **Gap to watch:** a direct Bill (not via PO/Receipt) with a tracked item
  still enforces this check — so if a bill is refused with a sourcing error,
  that's working as intended; link the supplier rather than filing it as a
  bug.
- [ ] **1.8 Barcodes**, if you scan anything. Supply Chain → Inventory →
  Products & Materials → item → Identifiers. One row per physical barcode,
  at the level it's printed (unit/inner/outer). Nothing scans yet — this is
  just the data foundation — so don't expect a scan-to-receive flow today.
- [ ] **1.9 BOM** — Supply Chain → Manufacturing → Bill of Materials. One BOM
  per finished (or WIP) output: input lines (material + qty per batch, in
  base UoM — non-base-unit entry converts automatically, or is refused if
  the units don't convert), operations (work centre + hours per batch, which
  pulls in that centre's rates), and expected yield % if scrap is normal for
  this product (0% yield on the BOM means every reject is treated as
  abnormal scrap).
- [ ] **1.10 Opening stock.** For a go-live with existing inventory, post an
  opening stock adjustment (Supply Chain → Inventory → Stock Adjustments →
  New count, or a write-up) per item/location at its known cost — this
  creates the first FIFO lot. Do this before any sale is recorded against
  that item.

**Checkpoint:** `/admin/reconcile` → `inventory_vs_gl` should already pass
with zero lines at this point, since nothing has moved yet.

---

## Phase 2 — Customer order intake (your Step 2)

- [ ] **2.1 Customer master data.** Receivables → Customers → New (or link an
  existing QBO/Xero customer). Set currency if this customer isn't in your
  home currency — a supplier/customer's currency is set once and can't be
  changed after documents exist against it.
- [ ] **2.2 Create the Sales Order.** Accounting → Trade → Sales Orders → New.
  Pick the customer, pick finished-product SKUs at whatever pack level the
  customer ordered in (each/carton/pallet — the line converts to base UoM
  automatically for planning). No accounting effect yet — an SO is
  non-posting.
- [ ] **2.3 (If relevant) link the SO to a Project** for cost/margin
  tracking, and to a **Resource** assignment if you're scheduling people or
  equipment against this specific order.
- [ ] **2.4 Variation — rush / partial-pack order.** Confirm a line can mix
  units (e.g., 3 cartons + 4 loose units of the same SKU) and that Committed
  quantity on Stock Status reflects it immediately.
- [ ] **2.5 Variation — export / foreign-currency SO.** If the customer's
  currency differs from home currency, confirm pricing, tax and the eventual
  invoice all resolve in the customer's currency, not home currency.

---

## Phase 3 — Planning: do you have enough raw material? (your Step 3)

⚠ **There is no MRP/netting engine in this app today** (confirmed gap — zero
references to reorder points, safety stock, or a net-demand screen). This
phase is manual. Walk it exactly as an accountant without MRP would, so the
friction is visible:

- [ ] **3.1 Open the BOM** for the finished product on the SO and multiply its
  input lines by the quantity ordered.
- [ ] **3.2 Check on-hand** — Supply Chain → Inventory → Stock Status — for
  each raw material, per location if you run more than one. Note Available =
  on-hand + expected (open PO/MO) − committed (open SO), not just on-hand.
- [ ] **3.3 Check what's already allocated** to OTHER open Manufacturing
  Orders — `planIssue` already nets this out for you (an MO's allocated lots
  are invisible to any other order's FIFO pick), so Stock Status's "available"
  figure should already be net of other orders' holds. Confirm it actually
  reads that way rather than showing raw on-hand.
- [ ] **3.4 Shortfall found → raise a Purchase Order** (Accounting → Trade →
  Purchase Orders, or link it from the Order Production Tracker on the SO
  itself if you're using order-linked traceability) for the missing raw
  material, against a linked supplier, at their quoted pack/price. If no
  shortfall, skip straight to Phase 5.
- [ ] **3.5 Decide lead time risk.** If the supplier's lead time on the
  sourcing link means the PO won't land before you need to start the MO, this
  is the point to flag the SO as at risk — there's no automatic delivery-risk
  alert at the PO-creation stage, only after the PO/Job Work/MO actually
  exists and has a due date past today (the Delivery Risk report and alert
  bell watch *existing* documents, they don't warn you during planning).

**This whole phase is the single biggest "are we doing a good job vs a real
ERP" gap** — note every manual step that felt like it should've been
automatic; that's the brief for a future MRP-lite screen.

---

## Phase 4 — Procure-to-pay for the shortfall (if Phase 3 found one)

- [ ] **4.1 PO → Goods Receipt.** Supply Chain → Inventory → Receiving. Record
  actual received qty (may differ from ordered), lot/batch number, supplier's
  batch number if they supply one (captured separately from your own lot
  number — don't conflate them), expiry/production/best-before dates if
  applicable, and the receiving **location**.
- [ ] **4.2 Variation — partial receipt.** Receive less than ordered; confirm
  the PO stays open with the remainder still expected, and Stock Status's
  "Expected" figure drops only by what actually arrived.
- [ ] **4.3 Variation — QC/quarantine.** If you inspect before accepting,
  receive into the Quarantine location, inspect, then Stock Transfer the
  accepted quantity into Store. (There's no dedicated accept/reject workflow
  — this is the manual equivalent using the existing Quarantine location
  type + a transfer.)
- [ ] **4.4 Bill from Receipt.** Supply Chain → Receiving console → "Bill
  from receipts." Enter the supplier's **invoice price** — if it differs
  from the receipt's GR/IR value, confirm the difference posts to Purchase
  Price Variance and the portion still sitting in stock revalues the lot
  (not just the expensed portion).
  ⚠ Receipts at different currencies/rates cannot be billed together — bill
  each currency/rate separately.
- [ ] **4.5 Variation — direct Bill, no PO/Receipt.** Post a Bill with a
  tracked raw-material line directly. Confirm it still creates a FIFO lot
  (Dr Inventory) and still enforces the sourcing-policy check.
- [ ] **4.6 Variation — supplier return.** If a batch is rejected after
  billing, raise a Vendor Credit with "Goods returned" ticked. Confirm it
  relieves the specific lot(s) that supplier supplied, and that the
  credit-vs-lot-cost gap lands in Purchase Price Variance, not Inventory.
- [ ] **4.7 Variation — Job Work (subcontracted processing).** If this raw
  material needs external processing (knitting/dyeing/etc.) before it's
  usable, dispatch it to the job worker (Supply Chain → Job Work) instead of
  straight to an MO. Confirm: dispatch doesn't touch COGS/revenue (ownership
  never transfers), the material sits in "Materials with Job Worker" until
  received back, and the job worker's processing fee alone flows through the
  ordinary three-way-match Bill path.

---

## Phase 5 — Manufacturing Order: plan and allocate

- [ ] **5.1 Create the MO** — Supply Chain → Manufacturing → Production
  Orders → New (ideally linked to the Sales Order for traceability). It
  copies the BOM's materials, operations and yield at this moment — a later
  BOM edit won't retroactively change this order.
- [ ] **5.2 Release the order.** Still no accounting effect — output is only
  "Expected" stock on Stock Status at this stage.
- [ ] **5.3 Move to In Progress and allocate lots.** Open the order's Input
  tab per material; accept or override the suggested FEFO lot pick. Confirm
  the picked quantities disappear from what any OTHER order can draw (lot
  allocation, not a generic reservation — see the Phase-3 note above on why
  this isn't quite the same as MRP-style reservation across Released orders).
  ⚠ Completion will **refuse** if any material has zero lots allocated — by
  design, so you can't accidentally cost a shortage at a guessed price.
- [ ] **5.4 Variation — split across several runs.** Use "Save for later" to
  reserve lots without starting a run yet, if you're staging material ahead
  of the actual production date.
- [ ] **5.5 Variation — the BOM has no output pack defined.** Confirm the MO
  still plans correctly, producing in the item's base unit.

---

## Phase 6 — Completing the MO (your Step 4)

- [ ] **6.1 Run a completion** — Output tab → capture actual good packs,
  rejected quantity, and hours per operation (defaults to proportional, but
  enter actuals where you have them — that's what makes the variance report
  meaningful later).
- [ ] **6.2 Variation — partial run.** Report fewer than the full order;
  confirm the MO stays In Progress with reduced allocation, and that the
  remaining allocated-but-unused material is still correctly held (only
  released on a FINAL run).
- [ ] **6.3 Variation — reject above expected yield.** Enter a reject count
  that exceeds the BOM's yield allowance; confirm the excess lands in Scrap
  & Yield Loss (abnormal) while normal loss is absorbed into good units'
  cost — not all dumped into one bucket.
- [ ] **6.4 Close the order** (final run). Confirm WIP nets to **exactly
  zero** for this order after the last run — that's the one number that
  proves the posting worked, not just that it didn't error.
- [ ] **6.5 Variation — void a completion run.** From the MO's own detail
  drawer, void a run; confirm packs come back off the order (reopens In
  Progress) and the consumed lots return to stock — but are NOT
  re-allocated, so you'd re-pick lots on redo.
- [ ] **6.6 Reconcile.** `/admin/reconcile` → confirm `inventory_vs_gl` still
  passes for the output item's stock account.

---

## Phase 7 — Fulfilment: ship and invoice (close the Sales Order)

- [ ] **7.1 Ship** — Supply Chain → Shipping console. Pick the SO, confirm
  COGS posts **at shipment** (Dr COGS / Cr Inventory at FIFO cost) — not
  later at invoicing.
- [ ] **7.2 Invoice from Shipment.** Confirm the invoice posts Dr A/R / Cr
  Revenue only — no second COGS hit (invoice lines here carry no `itemId`
  on purpose).
- [ ] **7.3 Variation — partial shipment.** Ship less than ordered; confirm
  the SO stays open and a second shipment/invoice completes it later.
- [ ] **7.4 Variation — direct Invoice, no SO/Shipment.** Confirm a direct
  invoice with a tracked item still posts both revenue and COGS itself (the
  bypass path).
- [ ] **7.5 Variation — customer return.** Raise a Credit Note / Refund
  Receipt with "Goods returned" ticked. Confirm stock goes back into the
  **lots it was actually sold from** (most-recent-first, net of earlier
  returns) at original cost — and that over-returning more than was sold is
  refused rather than silently creating negative stock.
- [ ] **7.6 Variation — price-only credit.** Same screen, "Goods returned"
  left unticked — confirm no stock movement, just a balance adjustment.
- [ ] **7.7 Send the invoice** through the AR email path and confirm the
  "Pay online" button appears (if QBO payments are enabled for this org) and
  the PDF carries the stamped pay button.

---

## Phase 8 — Collections (ordinary AR, same as any invoice)

- [ ] **8.1** Work the invoice through the Collections Board — stage,
  promise-to-pay, dispute, escalation — exactly as for a non-manufacturing
  invoice. No manufacturing-specific variation here; include it in the
  checklist only so the full O2C loop is exercised once, end to end.
- [ ] **8.2** Confirm the Order Production Tracker on the originating Sales
  Order shows the whole chain — PO → Receipt → MO → Shipment → Invoice — in
  one timeline, and that the Delivery Risk report would have flagged it had
  any linked PO/Job Work/MO date slipped.

---

## Phase 9 — Period-end / integrity checks (run after every cycle, not just once)

- [ ] **9.1 `/admin/reconcile`** — full run: entries balance, A/R and A/P
  control accounts agree with subledgers, nothing posted-but-missing from its
  subledger, nothing off-ledger, `invoices.paid` agrees with the links graph,
  `inventory_vs_gl`, `lot_placement_balances`, `placement_tenancy`.
- [ ] **9.2 Stock vs GL report** — Accounting → Reports → Stock vs GL — per
  inventory account, confirm no unexplained residual.
- [ ] **9.3 Stock count.** Do at least one physical-count cycle (Stock
  Adjustments → New count) against a real or test location, including a lot
  you deliberately under/over-count, to prove the variance posts to
  Inventory Adjustments and respects MO-allocated quantity as a floor.
- [ ] **9.4 Stock transfer.** Move stock between two locations and confirm it
  only hits the GL if the two locations map to different inventory accounts.
- [ ] ⚠ **9.5 Trial Balance, if this org is QBO/Xero-connected.** Confirm (and
  expect to be disappointed) that `/reporting/trial-balance` is still the QBO
  passthrough — the native GL ingestion exists but isn't wired into the live
  sync. If this org is **native** (no QBO/Xero), the native Trial Balance
  should be complete and correct; if it's QBO-connected, don't expect native
  financials to tie out yet.

---

## Use cases deliberately NOT covered above (raise separately if you need them)

- Multi-currency FX revaluation on inventory accounts (billing-currency
  handling exists; true FX variance on stock does not).
- Landed cost (freight/duty capitalised into lot cost) — not built.
- Fixed assets/depreciation, recurring journals, budgets — not built.
- Reorder points / MRP netting / safety stock — not built (this is what
  Phase 3 above works around manually).
- QC accept/reject as a first-class workflow — only the manual
  Quarantine-then-transfer pattern exists.
- Serial-number (per-unit) tracking — lot-level only.
- Co-product / by-product cost splitting across multiple BOM outputs — the
  data model supports several outputs per build; confirm with the product
  owner whether the costing rule for splitting between them is actually
  decided, per the open question already on record in the completion plan.

---

## After the walkthrough

Record, per step: **worked as expected** / **worked but felt wrong** (note
why) / **broke** (note the exact action and error). That list becomes the
backlog for "make the system stronger" — bring it back and we'll triage and
fix in priority order rather than ad hoc.
