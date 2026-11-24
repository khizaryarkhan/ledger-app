# Buyer's evaluation checklist (Test Organization / MSQ only)

Run through the live UI as a company deciding whether to buy. Mark each: [x] pass, [!] defect found (note + fix commit), [-] not applicable / not enabled for the org.
Rule: only Test Organization and MSQ. Note every document created so it can be cleaned up.

## 1. First impression and setup
- [ ] Sign in, switch organisation, theme (dark / light / system)
- [ ] Workspace switcher shows only the modules the org owns
- [ ] Settings: company profile, currency, financial year, logo
- [ ] Team: invite user, custom role, "Sign in as"
- [ ] Chart of accounts: list, add, edit, deactivate
- [ ] Tax rates, tax codes, classes, locations, cost centres, custom fields
- [ ] Opening balances
- [ ] Global search / command palette

## 2. Master data
- [ ] Customers: create (drawer), edit, delivery addresses, part numbers, statement
- [ ] Suppliers: create, edit, contacts, part numbers, terms
- [ ] Projects
- [ ] Products and services: service, non-inventory, raw material, finished product, SKUs, barcodes
- [ ] Posting groups mapping
- [ ] Employees / people, designations

## 3. Sales (order to cash)
- [ ] Estimate: create, send/print, convert
- [ ] Sales order: create (pack level, price), confirm
- [ ] Shipment: ship stock, packing, SSCC labels
- [ ] Invoice: direct, from shipment, edit, PDF, email, recurring
- [ ] Credit note, refund receipt, sales receipt
- [ ] Customer payment, deposit
- [ ] Collections board: stage, promise, dispute, send chase, statement

## 4. Purchases (procure to pay)
- [ ] Purchase order: create, confirm, send, supplier portal
- [ ] Goods receipt: PO-linked, no PO, lots, correct a receipt
- [ ] Bill: direct, from receipt, from PO, due date, attachments
- [ ] Bill payment, payment run, vendor credit, expense
- [ ] Payables list status agrees with ledger

## 5. Manufacturing
- [ ] BOM builder, substitutes, packaging
- [ ] Manufacturing order: schedule, release, allocate lots, complete run, void
- [ ] Work centres, operations, labour/overhead
- [ ] Stock count, write-down, transfer, locations
- [ ] Job work

## 6. Accounting
- [ ] Journal entry, transfer, reconcile, approvals
- [ ] Recurring templates
- [ ] Budgets, fixed assets and depreciation
- [ ] Period lock / year end

## 7. Reports (each: opens, figures tie, filters, export)
- [ ] Trial balance, P&L, balance sheet, comprehensive income, changes in equity, cash flow
- [ ] General ledger, AR ageing, AP ageing
- [ ] Stock vs GL, item ledger, stock status, lot traceability
- [ ] Budget vs actual, delivery performance, production performance, credits and adjustments
- [ ] Dashboards: accounting, receivables, payables, executive
- [ ] Cross-check: sub-ledgers = control accounts, stock = ledger

## 8. EDI
- [ ] Trading partner set up (supplier and customer)
- [ ] Outbound 850 from a PO, 855 from SO, 856 from shipment, 810 from invoice
- [ ] Inbound 850, 855, 856, 810, 997/999/TA1
- [ ] Acknowledgements, review queue, files list

## 9. Resources / people
- [ ] Resource board, booking, timesheet entry and approval
- [ ] Compliance, utilisation, hours-over-plan, notifications
- [ ] My dashboard, my details

## 10. Platform
- [ ] Data Studio (QBO/Xero not connected: confirm graceful message)
- [ ] AI connections / PAX console
- [ ] Audit trail on a document, attachments
- [ ] Mobile width (375px) on the main screens
- [ ] Empty states, error messages, loading, no console errors

## Findings log
(Append: area, what happened, severity, fix commit.)

### Pass 1 (22-23 Nov 2026, Test Organization)
- [!] Paid native bill stayed Unpaid in Payables -> fixed (syncNativeBillPaid), repaired BILL-0004 with scripts/resync-native-bill-paid.ts; dashboard warning cleared live.
- [!] Customers list defaulted to "Active" (= owes money) so a newly created customer vanished -> default now All.
- [!] "EUR" shown on a USD org (Credits & Adjustments, Production Performance, list totals) -> fmt.money now defaults to the org currency.
- [!] Tax Liability showed "-0.00"; Budget vs Actual subtitle began with a stray dash; EDI subtitle said "purchase orders" only -> fixed.
- [!] General Ledger rows cannot be opened (expand only), Payables bill page has no link to the ledger entry -> open.
- [x] Reports opened and tied: dashboard, AR/AP ageing, cash flow, stock status, open POs, expected bills, delivery/production performance, EDI files list, resource board.
- [!] /payables returned 404 -> now redirects to the Payables dashboard. Plural slips ("1 customers", "1 open invoices") fixed on the Board and Receivables dashboard.
- [x] Sales orders, estimates, chart of accounts, receivables dashboard and Board load with correct figures.
- Still to do: sales flow with a fresh order, EDI send/receive on a new document, settings/team/roles, Data Studio, PAX console, resources timesheets, mobile width, dark/light.

### Pass 2
- [x] Settings hub, company, team, roles, currency, numbering, email, integrations, AI connections, billing, Data Studio, PAX console all load.
- [!] Owner's My Timesheet said "login not linked to a person" -> resolveActor links real members on first use.
- [!] Billing empty state was a dead end -> explains plans are set up by the team and gives the contact address. "1 open bills" plural fixed.

### Pass 3
- [x] Phone width (390px): dashboard stacks cleanly, no horizontal overflow on customers, sales orders, P&L, EDI, board, settings. Dark theme legible.
- [x] Estimate created (EST-0001, 450.00) and converted to INV-0004.
- [!] **Estimate -> invoice for a stocked item posted revenue but did not issue stock or book cost of sales** (lines had no quantity). Fixed in convertTradeDoc; test added. INV-0004 in Test Organization predates the fix (stock/COGS missing) and is to be deleted and redone.
- [!] Ledger rows now have an "Open" link; Payables bill page links to its ledger entry.
- [ ] Open polish: 63 native confirm() popups across the app (hang browser automation, look dated, refused in some embedded browsers).
- [!] Deleting an invoice made from an estimate left the estimate "Fully invoiced" for ever -> convertTradeDoc tags lines (tradeLineId); deleteDocument gives the amounts back and reopens the source (also covers PO -> bill). EST-0001 in Test Organization predates this (to be deleted and redone).

## Pass 4 (2026-11-23): estimate conversion verified live

- EST-0001 in Test Organization predated the fix and sat "Fully invoiced" with no invoice; the app could not delete it ("reverse those first"). Added `scripts/_fix_orphaned_converted_trade_docs.ts` (dry run by default, `--org-name` required) and reopened it. Estimates and POs only; it tests invoiced amount / converted entry, NOT `billedQty` (receipts drive that, so PO-0003/PO-0004 were correctly left alone).
- Re-ran "Invoice remaining" on deployed code: INV-0005 posted Cost of Sales 43.38 and reduced Finished Goods Inventory to 109.02. Stock vs GL ties, Trial Balance balances (3,341.00). Estimate-to-invoice stock fix CONFIRMED.
- Delete guard wording said "reverse"; now "delete".
- Fixed assets: created via inline account quick-add (types preset correctly), depreciation preview/post/re-run is idempotent ("Nothing to post"). Entry is dated month end, so a Trial Balance "as at today" before month end correctly omits it. Register's "Accumulated" is the schedule to date, not the posted amount (labelling polish).
- Budgets: create, grid, save, Budget vs Actual tie to the ledger.
- Period close: closed through 22 Nov (1,172.87 to Retained Earnings), delete of a locked-period entry was refused, reopen reversed the closing entry cleanly. FOUND: the refusal was shown with a native alert() that froze the browser; journal delete now uses the shared centred Modal with the refusal inline. Reversal memo said "Reversal of JE-17" (raw sequence); now the visible JE-0002.
- Resources reports (compliance, hours over plan, utilization) render; the super admin has no timesheet in an org they are not a member of (by design; copy could say so).
- MSQ is empty (0 invoices), so no cross-org cycle was possible without creating data.
- EDI on an invoice not made from shipments refuses clearly ("This customer has no EDI profile").
- Still open: ~60 native confirm()/alert() left across the app, onboarding checklist assumes QuickBooks, super-admin copy on My Timesheet.

## Pass 5 (2026-11-24): reports by parameter, EDI review queue

- All 28 reports opened in the UI and the request each sends was read. Defaults now follow the org's fiscal year start (GL, Cash Flow, Tax Liability, Credits & Adjustments, Delivery/Production Performance); "today" is the viewer's local date; every report states org, currency and run date; Cash Flow has a statement header; Trial Balance is ordered by class; blank OTIF tiles explain themselves. Closed-PO lines, reversed year-end closes, direct-invoice lot traces and budget monthly totals were fixed earlier in the pass.
- NOT done: changing presets, columns, compare-to or custom dates and confirming the request follows; Stock Valuation / Stock Status / open-order reports have no as-at date.
- EDI: files list shows sent/received status and partner acknowledgement; "needs review" opens a drawer that names the order, the unknown part number and the fix (850 with an unregistered BP number). The status text only underlines on hover, so it is easy to miss that it is clickable.
- Still open: PAX console chat (needs a model key), 375px checks in the browser tool, printed lot-trace sheet, Team invite/Sign in as (creating users needs permission).
