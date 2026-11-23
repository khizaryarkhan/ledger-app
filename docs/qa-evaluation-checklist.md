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
