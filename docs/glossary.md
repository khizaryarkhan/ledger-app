# Glossary

- **Purpose:** Domain and technical terms used across this documentation and in the code.
- **Audience:** Anyone reading the other documents.
- **Last verified against:** commit `3eec3df` (2026-09-17)
- **Primary sources:** `db/schema.ts`, `lib/`, `CLAUDE.md`

## Accounts receivable and collections

| Term | Meaning |
|---|---|
| **AR** | Accounts receivable — money owed **to** the organisation by its customers. |
| **AP** | Accounts payable — money the organisation owes **to** its suppliers. |
| **DSO** | Days sales outstanding — average days between issuing an invoice and being paid. Reducing it is the product's commercial purpose. |
| **Aging** | Grouping open balances by how overdue they are: Current, 1–30, 31–60, 61–90, 90+. |
| **As at** | The date a report is calculated for. **A receivable exists from the day it is invoiced**, so an invoice dated after the report date is not receivable then. `isWithinAsAt()` in `lib/format.ts` is the single rule. |
| **Balance** | Total minus paid. For provider-mirrored invoices, `qboBalance ?? total − paid`; for native ones, GL truth from `lib/accounting/payments.ts`. |
| **Chase** | Sending a reminder email about an overdue invoice. The daily chase is the system's main automation. |
| **Collection stage** | The single dynamic state of an invoice in the chasing process. Per-organisation and editable, with four locked keys (`New`, `Promised`, `Disputed`, `Closed`). |
| **Exception stage** | Disputed, Escalated or On Hold. **Colour on the board means exception and nothing else** — these get a filled chip; every other stage gets quiet text and a hue dot. |
| **Escalation** | Handing an invoice to an owner. The stage stays "Escalated"; the *escalation type* (Handed Over, Final Account, Retention, Legal, …) is the "why". |
| **Promise to pay** | A debtor's commitment to a date. Lifecycle: `Active` → `Superseded` (replaced by a newer promise) → `Met` or `Broken` (written by the daily cron sweeps). |
| **Broken commitment** | A promise whose date has passed. Deliberately ranked *hotter* than Disputed on the board — the customer named a date and missed it. |
| **Dispute** | A customer's objection to an invoice. Pauses automation (`automationsPaused`) until resolved. |
| **Collections Board** | `/board` — the daily working screen. Rows are open invoices, grouped Customer → Project. |
| **Receivable Composition** | The classifier splitting open AR into workable / blocked / not-yet-due. Three semantic colours: rose = blocked, sky = workable, emerald = current. |
| **Customer portal** | The tokenised, no-login page a debtor reaches from a chase email to promise a date or raise a query. |
| **Owner portal** | The tokenised, no-login page an escalation owner reaches. |
| **Rep** | A sales representative. `reps` is a sales-collections hierarchy (rep / rd / ed) with a manager chain, distinct from `users` and from `employees`. |
| **Written Off** | A genuine AR outcome: debt pursued and given up on. **Not** the same as a soft-deleted invoice. |

## Accounting

| Term | Meaning |
|---|---|
| **GL** | General ledger — the double-entry book. Here: `journal_entries` plus `journal_lines`. |
| **Journal entry** | The transaction header. `source_type` is the document-type discriminator (Invoice, Bill, Payment, CreditNote, Manual, Reversal). |
| **Posting** | Writing a balanced set of debit and credit lines to the GL. Only `postJournalEntry` and `postDocument` may do it. |
| **Reversal** | The only correction mechanism. Entries are immutable; a reversal is a new entry pointing back at the original. |
| **Chart of accounts** | The organisation's list of ledger accounts (`accounts`, aliased `ap_accounts` in code). |
| **System account** | An account the application needs by role rather than by name — Inventory Asset, COGS, GR/IR Clearing, Materials with Job Worker, Suspense. Resolved by subtype. |
| **Suspense (1999)** | Where an unresolvable account goes during QuickBooks GL mapping, so a line is never dropped. **Created on demand**, never seeded, so it does not appear in every organisation's chart. |
| **Trial balance** | All account balances as at a date; debits must equal credits. **A trial balance shown to anyone must come from our own `journal_lines`** (`lib/accounting/financials.ts`), never from QuickBooks. |
| **Control account** | A GL account summarising a subledger — A/R against invoices, A/P against bills. Reconciliation asserts they agree. |
| **Subledger** | The detailed records behind a control account. |
| **Bridge** | `bridgeNativeInvoice` / `bridgeNativeBill` — mirroring a posted GL entry into the collections and payables modules so those screens see it. |
| **Settlement graph** | Which payments settle which documents. Two exist: `transaction_links` (native) and `payment_applications` (QuickBooks mirror). |
| **Linked transaction** | A relationship between documents — estimate → invoice, PO → bill, payment → invoice, deposit sweep. The native equivalent of QuickBooks' `LinkedTxn`. |
| **Trade document** | A non-posting commercial document: estimate, purchase order, sales order. `trade_documents` / `trade_document_lines`. |
| **Period close** | Locking a date range so entries on or before `book_close_date` cannot be posted. |
| **Opening balances** | The starting position of each account when an organisation begins keeping books in the app. |
| **FX** | Foreign exchange. `debit`/`credit` are always **home** currency; `fxDebit`/`fxCredit` plus `exchangeRate` record what was entered. |

## Supply chain and inventory

| Term | Meaning |
|---|---|
| **Perpetual inventory** | Stock value updated on every movement, not periodically. |
| **FIFO lot** | `inventory_lots` — a dated cost layer. Issues relieve the oldest layer first, at exact cost. |
| **COGS** | Cost of goods sold. Posted at **shipment** in the sales flow, or at invoice for a direct invoice carrying inventory items. |
| **BOM** | Bill of materials — the recipe of output item from input items. |
| **Production build** | Consuming picked input lots and producing an output lot at the summed cost. Dr output inventory / Cr each input inventory; no profit-and-loss effect. Numbered in the `BUILD-` series. |
| **MO** | Manufacturing order. |
| **Goods receipt (GR)** | Recording that purchased stock physically arrived. Dr Inventory / Cr GR/IR clearing, and creates the FIFO lot. |
| **GR/IR** | Goods-received / invoice-received clearing account. Sits between receiving stock and receiving the supplier's bill. |
| **Three-way match** | Purchase order → goods receipt → bill. Every step is bypassable. |
| **Shipment** | Recording that stock physically left. Dr COGS / Cr Inventory at FIFO cost. |
| **Job work** | Subcontracting: material is sent to a vendor for processing and comes back transformed, **owned throughout**. Neither a purchase nor a sale — its own pattern, cleared through a "Materials with Job Worker" account that must net to zero. |
| **Lot traceability** | Following a lot through receipts, production and shipments. |
| **Item kind** | `FinishedProduct` / `StockItem` / `RawMaterial` / `WorkInProgress` / `NonInventory` / `Service`. Declares tracked / sellable / buyable / producible / consumable, which is what drives accounting behaviour. |

## Platform and architecture

| Term | Meaning |
|---|---|
| **Org / organisation** | A tenant. Every tenant-owned row carries `org_id`. |
| **Org group** | A head-office spine several organisations map into, for a consolidated read. |
| **Module** | A per-organisation product entitlement (`receivables`, `payables`, `studio`, `accounting`, `manufacturing`, `resources`). Assigned by a platform admin, enforced by `requireModule()`. |
| **Workspace** | A top-level navigation area in the sidebar. Mostly one per module. |
| **Data Studio** | The bulk import / export / update / delete tool for QuickBooks and Xero. `/batch/*`. |
| **Chunked job** | A long-running job processed in resumable slices under a lease and cursor (`lib/batch/lease.ts`). |
| **Lease** | The claim a worker holds on a chunked job, renewed per item, so two invocations never process the same cursor. |
| **Reaper / watchdog** | `lib/batch/reap.ts` and `batchJobWatchdog` — nudge a stuck chunked job back to life rather than failing it. |
| **Sparse update** | QuickBooks' partial-update mode. **Unsafe for any payload carrying a `Line` array**, because id-less lines are treated as new. |
| **SyncToken** | QuickBooks' optimistic-concurrency token. Must always come from a fresh read, never from a downloaded spreadsheet. |
| **Realm** | A QuickBooks company. `realmId` identifies it. |
| **Tenant** | See org. |
| **White-label** | Serving an organisation's own branding. Currently: a branded subdomain on four pre-auth pages, plus logo and display name in the app shell and portals. |
| **Shadow** | Code that runs but whose output nothing reads — used here of the QuickBooks GL ingestion. |

## Technical

| Term | Meaning |
|---|---|
| **App Router** | Next.js 13+ routing where directories under `app/` define routes; `page.tsx` is a page and `route.ts` an API handler. |
| **Route group** | A parenthesised directory such as `(app)` that groups routes without appearing in the URL. |
| **Edge runtime** | Vercel's lightweight runtime. `middleware.ts` runs here, which is why `auth.config.ts` may not import Node modules or the database. |
| **`waitUntil`** | Vercel's mechanism for keeping a function alive after the response is sent — used to process webhooks and the first sync in the background. |
| **neon-http** | The Neon driver used here. Each statement is its own `fetch`. **No transactions.** |
| **Drizzle** | The TypeScript ORM. `db/schema.ts` is both schema and types. |
| **Compensating action** | Undoing an earlier write by hand when a later one fails, in the absence of transactions. |
| **Fail-open / fail-closed** | Whether a failing control allows or denies. The rate limiter fails **open**; OAuth state verification fails **closed**. |
| **Inngest** | The background-job platform. Schedules, retries, memoises steps, and calls back into `/api/inngest`. |
| **Memoised step** | An Inngest `step.run` whose completed result is replayed rather than re-executed on retry. |
| **Architecture test** | A grep-based structural assertion in `tests/architecture.test.ts`, each written after a real incident and proven to fail on the violation. |
| **Date-only value** | A calendar date with no time or timezone, stored as a `YYYY-MM-DD` string. **`new Date("2026-09-15")` parses as UTC midnight and renders a day early west of Greenwich — never do it.** |
